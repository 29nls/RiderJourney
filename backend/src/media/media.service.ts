import {
  ConflictException,
  GoneException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnauthorizedException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.js';
import { REALTIME_STORE, type RealtimeStore } from '../realtime/realtime.store.js';
import { type CreateUploadDto, IMAGE_TYPES, VIDEO_TYPES } from './media.dto.js';
import { enqueueMediaDeletion } from './deletion-outbox.js';
import { ModerationService } from './moderation.service.js';
import { OBJECT_STORAGE, type ObjectStorage } from './object-storage.js';
import { StorageQuotaService } from './storage-quota.js';

const ALLOWED: Record<string, string> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
};

/** Magic bytes prove the object is the type claimed at intent time. */
const MAGIC: Record<string, { offset: number; bytes: number[] }> = {
  'image/jpeg': { offset: 0, bytes: [0xff, 0xd8, 0xff] },
  'image/png': { offset: 0, bytes: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] },
  'image/webp': { offset: 0, bytes: [0x52, 0x49, 0x46, 0x46] },
  'video/mp4': { offset: 4, bytes: [0x66, 0x74, 0x79, 0x70] },
  'video/webm': { offset: 0, bytes: [0x1a, 0x45, 0xdf, 0xa3] },
};

const VIDEO_PURPOSES = new Set(['post_video', 'album_video']);

export type MediaAssetRow = {
  id: string;
  owner_id: string;
  purpose: string;
  mime_type: string;
  size_bytes: number;
  object_key: string;
  status: string;
  moderation_status: string;
  album_id: string | null;
  post_id: string | null;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  taken_at: Date | null;
  caption: string | null;
  sort_index: number;
  scan_status?: string;
  checksum_sha256?: string | null;
  upload_expires_at?: Date | null;
};

/** Every table that points at a media asset. Used before any deletion. */
const REFERENCE_SQL = `
  SELECT 'post' AS kind FROM post_media WHERE media_id = $1
  UNION ALL SELECT 'trip' FROM trip_photos WHERE media_id = $1
  UNION ALL SELECT 'poster' FROM posters WHERE media_id = $1
  UNION ALL SELECT 'hazard' FROM hazard_reports WHERE photo_media_id = $1
  UNION ALL SELECT 'avatar' FROM rider_profiles WHERE avatar_media_id = $1
  UNION ALL SELECT 'avatar' FROM users WHERE avatar_media_id = $1
  UNION ALL SELECT 'vehicle' FROM vehicles WHERE photo_media_id = $1
  UNION ALL SELECT 'album_cover' FROM albums WHERE cover_media_id = $1
  UNION ALL SELECT 'album' FROM media_assets WHERE id = $1 AND album_id IS NOT NULL`;

function magicMatches(mimeType: string, head: Buffer): boolean {
  const magic = MAGIC[mimeType] ?? { offset: 0, bytes: [] };
  const slice = head.subarray(magic.offset, magic.offset + magic.bytes.length);
  return magic.bytes.length > 0 && magic.bytes.every((byte, index) => slice[index] === byte);
}

@Injectable()
export class MediaService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REALTIME_STORE) private readonly store: RealtimeStore,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly quota: StorageQuotaService,
    private readonly moderation: ModerationService,
  ) {}

  private assertStorage(): void {
    if (!this.config.mediaS3Bucket || !this.config.mediaS3AccessKey || !this.config.mediaS3SecretKey) {
      throw new ServiceUnavailableException({
        code: 'MEDIA_UNAVAILABLE',
        title: 'Unggah media belum dikonfigurasi',
        detail: 'MEDIA_S3_BUCKET, MEDIA_S3_ACCESS_KEY, and MEDIA_S3_SECRET_KEY must be set.',
      });
    }
  }

  private isVideo(contentType: string): boolean {
    return (VIDEO_TYPES as readonly string[]).includes(contentType);
  }

  async createIntent(userId: string, dto: CreateUploadDto) {
    this.assertStorage();
    const videoPurpose = VIDEO_PURPOSES.has(dto.purpose);
    const videoType = this.isVideo(dto.contentType);
    if (videoPurpose !== videoType) {
      throw new UnprocessableEntityException({
        code: 'MEDIA_TYPE_UNSUPPORTED',
        title: 'Format media tidak sesuai',
        detail: videoPurpose ? 'Unggahan ini hanya menerima video MP4 atau WebM.' : 'Unggahan ini hanya menerima foto JPEG, PNG, atau WebP.',
      });
    }
    const allowed = videoPurpose ? this.config.mediaMaxVideoBytes : this.config.mediaMaxBytes;
    if (dto.sizeBytes <= 0 || dto.sizeBytes > allowed) {
      throw new UnprocessableEntityException({
        code: 'MEDIA_TOO_LARGE',
        title: 'Ukuran media tidak didukung',
        detail: `Ukuran maksimum ${Math.floor(allowed / 1024)} KB untuk jenis unggahan ini.`,
      });
    }
    const ext = ALLOWED[dto.contentType];
    if (!ext) {
      throw new UnprocessableEntityException({ code: 'MEDIA_TYPE_UNSUPPORTED', title: 'Format media tidak didukung', detail: 'Gunakan JPEG, PNG, WebP, MP4, atau WebM.' });
    }

    const existing = await this.db.query<{ id: string; object_key: string; mime_type: string; status: string; upload_expires_at: Date | null }>(
      `SELECT id, object_key, mime_type, status, upload_expires_at FROM media_assets WHERE owner_id = $1 AND client_media_id = $2`,
      [userId, dto.clientMediaId],
    );
    if (existing[0]) {
      if (existing[0].status === 'expired') {
        // The lapsed attempt may have left an object behind. A fresh key means
        // the If-None-Match precondition cannot collide with those bytes; the
        // cleanup worker still enqueues deletion for the old key.
        const rotatedKey = `media/${userId}/${uuidv7()}.${ext}`;
        await this.quota.reserveUpload(userId, dto.sizeBytes);
        const rearmed = await this.db.query<{ id: string }>(
          `UPDATE media_assets
           SET status = 'pending', object_key = $2, mime_type = $3, size_bytes = $4,
               checksum_sha256 = $5, upload_expires_at = now() + ($6 || ' seconds')::interval
           WHERE id = $1 AND status = 'expired'
           RETURNING id`,
          [existing[0].id, rotatedKey, dto.contentType, dto.sizeBytes, dto.checksumSha256.toLowerCase(), this.config.mediaUploadTtlSeconds],
        );
        if (rearmed[0]) return this.grant(existing[0].id, rotatedKey, dto.contentType);
        await this.quota.releaseReservation(userId, dto.sizeBytes);
        return { id: existing[0].id, status: 'expired', uploadUrl: null, duplicate: true };
      }
      if (existing[0].status === 'pending') {
        // The key is fixed for this intent, so a retry only extends the window
        // of the same presigned target instead of creating another object.
        await this.db.query(
          `UPDATE media_assets SET upload_expires_at = now() + ($2 || ' seconds')::interval WHERE id = $1`,
          [existing[0].id, this.config.mediaUploadTtlSeconds],
        );
        return this.grant(existing[0].id, existing[0].object_key, existing[0].mime_type);
      }
      return { id: existing[0].id, status: existing[0].status, uploadUrl: null, duplicate: true };
    }

    const hourly = await this.store.incrementRateLimit(`media:upload:${userId}`, 3600);
    if (hourly > 60) {
      throw new HttpException(
        { code: 'MEDIA_RATE_LIMITED', title: 'Terlalu banyak unggahan', detail: 'Batas unggahan media per jam tercapai.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const id = uuidv7();
    // Key is fully server-generated: no client input reaches the path.
    const objectKey = `media/${userId}/${id}.${ext}`;

    // Reserve quota before creating intent.
    await this.quota.reserveUpload(userId, dto.sizeBytes);

    await this.db.query(
      `INSERT INTO media_assets (id, owner_id, purpose, mime_type, size_bytes, object_key, status, client_media_id, checksum_sha256, upload_expires_at)
       VALUES ($1, $2, $3, $4, $5, $6, 'pending', $7, $8, now() + ($9 || ' seconds')::interval)`,
      [id, userId, dto.purpose, dto.contentType, dto.sizeBytes, objectKey, dto.clientMediaId, dto.checksumSha256.toLowerCase(), this.config.mediaUploadTtlSeconds],
    );
    return this.grant(id, objectKey, dto.contentType);
  }

  /**
   * Short-lived upload grant. The bucket stays private and no storage
   * credentials reach the client: the SigV4 URL lets this owner PUT one
   * server-chosen key, with a matching content type, and cannot replace an
   * object that already exists.
   */
  private async grant(mediaId: string, objectKey: string, contentType: string) {
    const expiresIn = this.config.mediaUploadTtlSeconds;
    const uploadUrl = await this.storage.presignPut(objectKey, contentType, expiresIn);
    return {
      id: mediaId,
      status: 'pending',
      uploadUrl,
      method: 'PUT',
      requiredHeaders: { 'Content-Type': contentType, 'If-None-Match': '*' },
      expiresIn,
      note: 'Putar ulang permintaan dengan clientMediaId yang sama agar URL yang kedaluwarsa diganti tanpa membuat baris ganda.',
    };
  }

  private async reject(asset: MediaAssetRow, code: string, detail: string): Promise<never> {
    const rejected = await this.db.query<{ owner_id: string; size_bytes: number }>(
      `UPDATE media_assets SET status = 'rejected' WHERE id = $1 AND status = 'pending'
       RETURNING owner_id, size_bytes`,
      [asset.id],
    );
    // A rejected upload will never become ready, so its reservation must go
    // back now; otherwise one bad file blocks the quota until reconcile runs.
    if (rejected[0]) await this.quota.releaseReservation(rejected[0].owner_id, rejected[0].size_bytes);
    throw new ConflictException({ code, title: 'Verifikasi media gagal', detail });
  }

  /**
   * Completion trusts neither sizeBytes nor contentType from the request. The
   * object is read back from storage: HEAD gives length and metadata, and a
   * streamed SHA-256 plus magic-byte check proves the bytes.
   */
  async complete(userId: string, mediaId: string) {
    const rows = await this.db.query<MediaAssetRow>(
      `SELECT id, owner_id, mime_type, size_bytes, object_key, status, purpose, checksum_sha256,
              upload_expires_at, scan_status
       FROM media_assets WHERE id = $1 AND owner_id = $2`,
      [mediaId, userId],
    );
    const asset = rows[0];
    if (!asset) throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', title: 'Media tidak ditemukan', detail: 'Aset media tidak tersedia untuk akun ini.' });
    if (asset.status === 'ready') {
      return { id: asset.id, status: 'ready', purpose: asset.purpose, scanStatus: asset.scan_status, duplicate: true };
    }
    if (asset.status !== 'pending') {
      throw new ConflictException({ code: 'MEDIA_NOT_PENDING', title: 'Media tidak menunggu unggahan', detail: `Status aset: ${asset.status}.` });
    }
    if (!asset.upload_expires_at || new Date(asset.upload_expires_at).getTime() <= Date.now()) {
      throw new GoneException({ code: 'MEDIA_UPLOAD_EXPIRED', title: 'Unggahan kedaluwarsa', detail: 'Buat intent unggahan baru.' });
    }
    const expectedChecksum = (asset.checksum_sha256 ?? '').toLowerCase();
    if (!/^[0-9a-f]{64}$/.test(expectedChecksum)) {
      throw new ConflictException({ code: 'MEDIA_CHECKSUM_MISSING', title: 'Checksum tidak tersedia', detail: 'Intent lama tanpa checksum tidak dapat diselesaikan; buat intent baru.' });
    }

    const head = await this.storage.head(asset.object_key);
    if (!head) {
      throw new ConflictException({ code: 'MEDIA_OBJECT_MISSING', title: 'Objek belum diunggah', detail: 'Unggah file ke URL yang diberikan sebelum menyelesaikan.' });
    }
    if (head.contentLength !== asset.size_bytes) {
      return this.reject(asset, 'MEDIA_SIZE_MISMATCH', `Ukuran objek ${head.contentLength} byte, diharapkan ${asset.size_bytes} byte.`);
    }
    const actualType = (head.contentType ?? '').split(';')[0].trim().toLowerCase();
    if (actualType !== asset.mime_type) {
      return this.reject(asset, 'MEDIA_CONTENT_MISMATCH', `Tipe objek ${actualType || 'tidak diketahui'}, diharapkan ${asset.mime_type}.`);
    }

    const digest = createHash('sha256');
    let firstBytes = Buffer.alloc(0);
    let read = 0;
    const { stream } = await this.storage.openRead(asset.object_key);
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk);
      read += bytes.length;
      if (read > asset.size_bytes) {
        return this.reject(asset, 'MEDIA_SIZE_MISMATCH', 'Objek lebih besar dari ukuran yang dijanjikan.');
      }
      digest.update(bytes);
      if (firstBytes.length < 16) {
        firstBytes = Buffer.concat([firstBytes, bytes.subarray(0, 16 - firstBytes.length)]);
      }
    }
    if (read !== asset.size_bytes) {
      return this.reject(asset, 'MEDIA_SIZE_MISMATCH', `Hanya ${read} byte yang terbaca, diharapkan ${asset.size_bytes} byte.`);
    }
    if (digest.digest('hex') !== expectedChecksum) {
      return this.reject(asset, 'MEDIA_CHECKSUM_MISMATCH', 'SHA-256 objek tidak cocok dengan checksum yang dijanjikan.');
    }
    if (!magicMatches(asset.mime_type, firstBytes)) {
      return this.reject(asset, 'MEDIA_CONTENT_MISMATCH', 'Isi file bukan media sesuai tipe yang dijanjikan.');
    }

    const updated = await this.db.query<{ id: string }>(
      `UPDATE media_assets SET status = 'ready', ready_at = now(), size_bytes = $2
       WHERE id = $1 AND status = 'pending' AND upload_expires_at > now()
       RETURNING id`,
      [asset.id, read],
    );
    if (!updated[0]) {
      const current = await this.db.query<{ status: string }>(`SELECT status FROM media_assets WHERE id = $1`, [asset.id]);
      if (current[0]?.status === 'ready') {
        return { id: asset.id, status: 'ready', purpose: asset.purpose, scanStatus: asset.scan_status, duplicate: true };
      }
      throw new ConflictException({ code: 'MEDIA_NOT_PENDING', title: 'Media tidak dapat diselesaikan', detail: 'Status aset berubah selama verifikasi.' });
    }

    // Commit quota: convert reservation to used space.
    await this.quota.commitUpload(userId, read);

    // Scan state and moderation state are separate decisions: a clean file can
    // still need a human review before other people see it.
    await this.db.transaction(async (tx) => {
      await this.moderation.enqueueIfRequired(tx, asset.id, asset.purpose, userId);
    });

    // The row is ready for its owner; scan_status tells the client whether a
    // scanner still has to look at it before other users may see it.
    return { id: asset.id, status: 'ready', purpose: asset.purpose, scanStatus: 'unscanned' };
  }

  /** Returns the row only when this viewer may see the media, otherwise 404. */
  async accessible(userId: string, mediaId: string): Promise<MediaAssetRow> {
    const rows = await this.db.query<MediaAssetRow & { viewer_may_see: boolean }>(
      `SELECT m.id, m.owner_id, m.purpose, m.mime_type, m.size_bytes, m.object_key,
              m.status, m.moderation_status, m.scan_status, m.album_id, m.post_id, m.width, m.height,
              m.duration_s, m.taken_at, m.caption, m.sort_index,
              (m.owner_id = $2 OR (
                -- Fail-closed for everyone but the owner: unscanned or quarantined
                -- media is never served as if it had passed a scan, and content
                -- that needs review is only visible once approved.
                m.scan_status = 'clean' AND
                m.moderation_status IN ('approved', 'not_required') AND
                (m.moderation_status <> 'rejected' OR m.owner_id = $2) AND (
                  EXISTS (
                    SELECT 1 FROM post_media pm JOIN posts p ON p.id = pm.post_id
                    WHERE pm.media_id = m.id AND p.status = 'published' AND p.deleted_at IS NULL
                      AND (p.author_id = $2
                        OR p.audience = 'public'
                        OR (p.audience = 'followers' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $2 AND f.followee_id = p.author_id))
                        OR (p.audience = 'community' AND EXISTS (SELECT 1 FROM community_members cm WHERE cm.community_id = p.community_id AND cm.user_id = $2 AND cm.status = 'active')))
                  )
                  OR EXISTS (
                    SELECT 1 FROM albums a WHERE a.id = m.album_id AND a.deleted_at IS NULL
                      AND (a.owner_id = $2 OR a.visibility = 'public'
                        OR (a.visibility = 'followers' AND EXISTS (SELECT 1 FROM follows f WHERE f.follower_id = $2 AND f.followee_id = a.owner_id))
                        OR (a.visibility = 'community' AND EXISTS (SELECT 1 FROM community_members cm WHERE cm.community_id = a.community_id AND cm.user_id = $2 AND cm.status = 'active')))
                  )
                  OR EXISTS (
                    SELECT 1 FROM trip_photos tp JOIN trips t ON t.id = tp.trip_id
                    WHERE tp.media_id = m.id AND (t.user_id = $2 OR $2::uuid = ANY(t.shared_with))
                  )
                  OR m.purpose IN ('avatar', 'community_logo', 'community_cover', 'vehicle_photo', 'hazard_photo', 'poster')
                )
              )) AS viewer_may_see
       FROM media_assets m WHERE m.id = $1 AND m.status = 'ready'`,
      [mediaId, userId],
    );
    const asset = rows[0];
    if (!asset || !asset.viewer_may_see) {
      throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', title: 'Media tidak ditemukan', detail: 'Media tidak tersedia atau bukan untuk akun ini.' });
    }
    return asset;
  }

  private get accessSecret(): string {
    return this.config.mediaS3SecretKey || this.config.jwtSecret;
  }

  private signature(mediaId: string, expires: number): string {
    return createHmac('sha256', this.accessSecret).update(`${mediaId}.${expires}`).digest('base64url');
  }

  /**
   * Bytes a browser may load. Scan has no exemption at all: a quarantined,
   * unfinished, or failed scan withholds the file from everyone, admins and the
   * uploader included. Moderation keeps the owner exception (a clean file still
   * in review is theirs to look at); rejection and hiding remove it from the
   * owner too. Signed redemption is anonymous, so it renders as a non-owner.
   */
  private static bytesServeable(row: { scan_status?: string | null; moderation_status: string; isOwner?: boolean }): boolean {
    if ((row.scan_status ?? '') !== 'clean') return false;
    if (row.moderation_status === 'approved' || row.moderation_status === 'not_required') return true;
    if (row.moderation_status !== 'pending_review') return false;
    return row.isOwner === true;
  }

  /**
   * Mint a short-lived GET grant. No storage key is exposed without a valid
   * signature, and the signature is bound to one media id and one expiry.
   */
  async signGet(userId: string, mediaId: string, ttlSeconds = this.config.mediaSignedUrlTtlSeconds) {
    const asset = await this.accessible(userId, mediaId);
    const isOwner = asset.owner_id === userId;
    const scanStatus = asset.scan_status ?? '';
    const modStatus = asset.moderation_status ?? '';
    const blocked = scanStatus === 'quarantined' ? 'MEDIA_QUARANTINED' : scanStatus === 'scan_failed' ? 'MEDIA_SCAN_FAILED' : null;
    const state = {
      id: asset.id,
      mimeType: asset.mime_type,
      sizeBytes: asset.size_bytes,
      purpose: asset.purpose,
      scanStatus,
      moderationStatus: modStatus,
      pendingReview: modStatus === 'pending_review',
    };
    if (!MediaService.bytesServeable({ ...asset, isOwner })) {
      if (blocked) throw new ConflictException({ code: blocked, title: 'Media tidak disajikan', detail: `Status pemindaian: ${scanStatus}. Media yang tidak lolos pemindaian tidak disajikan.` });
      return { ...state, url: null, blockedReason: 'MEDIA_NOT_READY' };
    }
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const signature = this.signature(asset.id, expires);
    return {
      ...state,
      expiresAt: new Date(expires * 1000).toISOString(),
      expiresIn: ttlSeconds,
      url: `/v1/media/${asset.id}/access?expires=${expires}&signature=${encodeURIComponent(signature)}`,
    };
  }

  /**
   * Reviewer preview. Moderation happens before the file is visible to other
   * users, so the normal access path cannot serve it. This mints a short-lived
   * URL — but only for media the scanner has already cleared: a quarantined or
   * unscanned file is never handed to a browser, not even an admin's.
   */
  async previewForReview(mediaId: string) {
    const rows = await this.db.query<{
      id: string;
      object_key: string;
      scan_status: string;
      moderation_status: string;
      mime_type: string;
      size_bytes: number;
    }>(
      `SELECT id, object_key, scan_status, moderation_status, mime_type, size_bytes
       FROM media_assets WHERE id = $1 AND status = 'ready'`,
      [mediaId],
    );
    const row = rows[0];
    if (!row) {
      throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', title: 'Media tidak ditemukan', detail: 'Aset tidak tersedia.' });
    }
    if (row.scan_status !== 'clean') {
      throw new ConflictException({
        code: 'MEDIA_PREVIEW_BLOCKED',
        title: 'Pratinjau diblokir',
        detail: `Status pemindaian: ${row.scan_status}. Media yang belum lolos pemindaian tidak disajikan.`,
      });
    }
    return {
      id: row.id,
      url: await this.storage.presignGet(row.object_key, 120),
      mimeType: row.mime_type,
      sizeBytes: row.size_bytes,
      scanStatus: row.scan_status,
      moderationStatus: row.moderation_status,
      expiresInSeconds: 120,
    };
  }

  /** Verify a signed GET before any metadata is returned. */
  async verifySignedAccess(mediaId: string, expiresRaw: string, signature: string) {
    const expires = Number(expiresRaw);
    if (!Number.isInteger(expires) || expires * 1000 <= Date.now()) {
      throw new UnauthorizedException({ code: 'SIGNED_URL_EXPIRED', title: 'Tautan kedaluwarsa', detail: 'Buat tautan media baru.' });
    }
    const expected = Buffer.from(this.signature(mediaId, expires));
    const supplied = Buffer.from(signature);
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new UnauthorizedException({ code: 'SIGNED_URL_INVALID', title: 'Tautan tidak valid', detail: 'Tanda tangan media tidak cocok.' });
    }
    const rows = await this.db.query<MediaAssetRow>(
      `SELECT id, mime_type, size_bytes, object_key, purpose, status, scan_status, moderation_status
       FROM media_assets WHERE id = $1 AND status = 'ready'`,
      [mediaId],
    );
    if (!rows[0]) throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', title: 'Media tidak ditemukan', detail: 'Media tidak tersedia.' });
    // Re-check the fail-closed state at redemption: a URL minted while the row
    // was clean must not serve bytes that were quarantined or went back into
    // review afterwards. The signature proves possession, not who the viewer
    // is, so the owner-only pending_review exemption does not apply here.
    if (!MediaService.bytesServeable({ ...rows[0], isOwner: false })) {
      throw new UnauthorizedException({ code: 'SIGNED_URL_REVOKED', title: 'Tautan tidak berlaku', detail: 'Status media tidak lagi mengizinkan unduhan.' });
    }
    const download = await this.storage.presignGet(rows[0].object_key, 60);
    return {
      id: rows[0].id,
      mimeType: rows[0].mime_type,
      sizeBytes: rows[0].size_bytes,
      purpose: rows[0].purpose,
      expiresAt: new Date(expires * 1000).toISOString(),
      downloadUrl: download,
      downloadExpiresIn: 60,
    };
  }

  /**
   * Reference kinds currently pointing at this asset. Empty means nothing else
   * uses it and the bytes may be scheduled for deletion.
   */
  async referencesOf(mediaId: string, db: Database = this.db): Promise<string[]> {
    const rows = await db.query<{ kind: string }>(REFERENCE_SQL, [mediaId]);
    return [...new Set(rows.map((row) => row.kind))];
  }

  /**
   * Owner-requested deletion. The object is only enqueued when no other row
   * points at it; the media row moves to 'deleting' in the same transaction as
   * the outbox insert, and its bytes keep counting against the quota until the
   * worker proves the object is gone.
   */
  async requestDeletion(userId: string, mediaId: string) {
    const rows = await this.db.query<{ id: string; status: string; object_key: string }>(
      `SELECT id, status, object_key FROM media_assets WHERE id = $1 AND owner_id = $2`,
      [mediaId, userId],
    );
    const asset = rows[0];
    if (!asset) {
      throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', title: 'Media tidak ditemukan', detail: 'Aset media tidak tersedia untuk akun ini.' });
    }
    // Idempotent: asking twice is not an error and never enqueues twice.
    if (asset.status === 'deleted' || asset.status === 'deleting') {
      return { id: asset.id, status: asset.status, duplicate: true };
    }
    if (asset.status !== 'ready') {
      throw new ConflictException({
        code: 'MEDIA_NOT_DELETABLE',
        title: 'Media belum siap dihapus',
        detail: `Status aset: ${asset.status}. Unggahan yang belum selesai dibersihkan otomatis.`,
      });
    }

    const references = await this.referencesOf(mediaId);
    if (references.length > 0) {
      throw new ConflictException({
        code: 'MEDIA_IN_USE',
        title: 'Media masih digunakan',
        detail: `Lepas dulu dari: ${references.join(', ')}.`,
        references,
      });
    }

    const claimed = await this.db.transaction(async (tx) => {
      const updated = await tx.query<{ object_key: string }>(
        `UPDATE media_assets SET status = 'deleting', deletion_requested_at = now()
         WHERE id = $1 AND owner_id = $2 AND status = 'ready'
         RETURNING object_key`,
        [mediaId, userId],
      );
      if (!updated[0]) return null;
      await enqueueMediaDeletion(tx, [updated[0].object_key], 'user_delete');
      return updated[0].object_key;
    });
    if (!claimed) {
      // A concurrent request won; report its state instead of enqueuing again.
      const current = await this.db.query<{ status: string }>(
        `SELECT status FROM media_assets WHERE id = $1 AND owner_id = $2`,
        [mediaId, userId],
      );
      return { id: mediaId, status: current[0]?.status ?? 'deleted', duplicate: true };
    }
    return { id: mediaId, status: 'deleting', duplicate: false };
  }

  /**
   * Cancels a deletion, but only while the worker has not touched it. The
   * outbox row is locked FOR UPDATE together with the media row, so a worker
   * claiming at the same moment either wins the lock or finds no job. Once the
   * object may already be gone, cancellation is refused.
   */
  async cancelDeletion(userId: string, mediaId: string) {
    const rows = await this.db.query<{ id: string; status: string; object_key: string }>(
      `SELECT id, status, object_key FROM media_assets WHERE id = $1 AND owner_id = $2`,
      [mediaId, userId],
    );
    const asset = rows[0];
    if (!asset) {
      throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', title: 'Media tidak ditemukan', detail: 'Aset media tidak tersedia untuk akun ini.' });
    }
    if (asset.status === 'ready') {
      return { id: asset.id, status: 'ready', cancelled: true, duplicate: true };
    }
    if (asset.status === 'deleted') {
      throw new ConflictException({
        code: 'MEDIA_DELETION_COMPLETED',
        title: 'Media sudah terhapus',
        detail: 'Objek sudah dihapus dari storage dan tidak dapat dikembalikan.',
      });
    }
    if (asset.status !== 'deleting') {
      throw new ConflictException({
        code: 'MEDIA_NOT_DELETING',
        title: 'Media tidak sedang dihapus',
        detail: `Status aset: ${asset.status}.`,
      });
    }

    const outcome = await this.db.transaction(async (tx) => {
      const job = await tx.query<{ id: string; status: string; attempts: number }>(
        `SELECT id, status, attempts FROM media_deletion_outbox WHERE object_key = $1 FOR UPDATE`,
        [asset.object_key],
      );
      const row = job[0];
      if (!row) return 'no_job' as const;
      // attempts > 0 means a worker already claimed it at least once; the object
      // may be gone, so the request is refused rather than guessed about.
      if (row.status !== 'pending' || row.attempts > 0) return 'claimed' as const;

      const updated = await tx.query<{ id: string }>(
        `UPDATE media_assets SET status = 'ready', deletion_requested_at = NULL
         WHERE id = $1 AND status = 'deleting' RETURNING id`,
        [mediaId],
      );
      if (!updated[0]) return 'race' as const;
      await tx.query(`DELETE FROM media_deletion_outbox WHERE id = $1`, [row.id]);
      await tx.query(
        `INSERT INTO media_deletion_ops_log (id, outbox_id, actor_id, action, note)
         VALUES ($1, $2, $3, 'cancel', $4)`,
        [uuidv7(), row.id, userId, 'owner cancelled before the worker claimed the job'],
      );
      return 'cancelled' as const;
    });

    if (outcome === 'cancelled') return { id: mediaId, status: 'ready', cancelled: true };
    if (outcome === 'no_job') {
      throw new ConflictException({
        code: 'MEDIA_DELETION_IN_PROGRESS',
        title: 'Penghapusan sedang berjalan',
        detail: 'Job penghapusan sudah diproses; objek tidak dapat dibatalkan.',
      });
    }
    throw new ConflictException({
      code: 'MEDIA_DELETION_ALREADY_CLAIMED',
      title: 'Penghapusan sudah dimulai',
      detail: 'Worker sudah mengklaim job ini, sehingga objek mungkin telah dihapus.',
    });
  }

  /**
   * Called inside the transaction that detaches a pointer (avatar, vehicle
   * photo). The reference check runs after the detach, so media used elsewhere
   * is left untouched and only a genuinely unreferenced asset is enqueued.
   */
  async detachAndRelease(tx: Database, ownerId: string, mediaId: string | null, reason: string): Promise<void> {
    if (!mediaId) return;
    const references = await this.referencesOf(mediaId, tx);
    if (references.length > 0) return;
    const rows = await tx.query<{ object_key: string }>(
      `UPDATE media_assets SET status = 'deleting', deletion_requested_at = now()
       WHERE id = $1 AND owner_id = $2 AND status = 'ready'
       RETURNING object_key`,
      [mediaId, ownerId],
    );
    if (rows[0]) await enqueueMediaDeletion(tx, [rows[0].object_key], reason);
  }

  /** Purpose check used by posts, albums, and posters before they attach a row. */
  async ownedReadyMedia(userId: string, mediaId: string, purposes: string[]) {
    const rows = await this.db.query<MediaAssetRow>(
      `SELECT * FROM media_assets WHERE id = $1 AND owner_id = $2 AND status = 'ready'`,
      [mediaId, userId],
    );
    const asset = rows[0];
    if (!asset || !purposes.includes(asset.purpose)) {
      throw new UnprocessableEntityException({
        code: 'MEDIA_NOT_ATTACHABLE',
        title: 'Media tidak dapat dilampirkan',
        detail: 'Media harus sudah selesai diunggah dan sesuai jenis kontennya.',
      });
    }
    return asset;
  }
}
