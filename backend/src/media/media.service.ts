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
import { OBJECT_STORAGE, type ObjectStorage } from './object-storage.js';

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
  checksum_sha256?: string | null;
  upload_expires_at?: Date | null;
};

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

  private async reject(id: string, code: string, detail: string): Promise<never> {
    await this.db.query(`UPDATE media_assets SET status = 'rejected' WHERE id = $1 AND status = 'pending'`, [id]);
    throw new ConflictException({ code, title: 'Verifikasi media gagal', detail });
  }

  /**
   * Completion trusts neither sizeBytes nor contentType from the request. The
   * object is read back from storage: HEAD gives length and metadata, and a
   * streamed SHA-256 plus magic-byte check proves the bytes.
   */
  async complete(userId: string, mediaId: string) {
    const rows = await this.db.query<MediaAssetRow>(
      `SELECT id, owner_id, mime_type, size_bytes, object_key, status, purpose, checksum_sha256, upload_expires_at
       FROM media_assets WHERE id = $1 AND owner_id = $2`,
      [mediaId, userId],
    );
    const asset = rows[0];
    if (!asset) throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', title: 'Media tidak ditemukan', detail: 'Aset media tidak tersedia untuk akun ini.' });
    if (asset.status === 'ready') return { id: asset.id, status: 'ready', purpose: asset.purpose, duplicate: true };
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
      return this.reject(asset.id, 'MEDIA_SIZE_MISMATCH', `Ukuran objek ${head.contentLength} byte, diharapkan ${asset.size_bytes} byte.`);
    }
    const actualType = (head.contentType ?? '').split(';')[0].trim().toLowerCase();
    if (actualType !== asset.mime_type) {
      return this.reject(asset.id, 'MEDIA_CONTENT_MISMATCH', `Tipe objek ${actualType || 'tidak diketahui'}, diharapkan ${asset.mime_type}.`);
    }

    const digest = createHash('sha256');
    let firstBytes = Buffer.alloc(0);
    let read = 0;
    const { stream } = await this.storage.openRead(asset.object_key);
    for await (const chunk of stream) {
      const bytes = Buffer.from(chunk);
      read += bytes.length;
      if (read > asset.size_bytes) {
        return this.reject(asset.id, 'MEDIA_SIZE_MISMATCH', 'Objek lebih besar dari ukuran yang dijanjikan.');
      }
      digest.update(bytes);
      if (firstBytes.length < 16) {
        firstBytes = Buffer.concat([firstBytes, bytes.subarray(0, 16 - firstBytes.length)]);
      }
    }
    if (read !== asset.size_bytes) {
      return this.reject(asset.id, 'MEDIA_SIZE_MISMATCH', `Hanya ${read} byte yang terbaca, diharapkan ${asset.size_bytes} byte.`);
    }
    if (digest.digest('hex') !== expectedChecksum) {
      return this.reject(asset.id, 'MEDIA_CHECKSUM_MISMATCH', 'SHA-256 objek tidak cocok dengan checksum yang dijanjikan.');
    }
    if (!magicMatches(asset.mime_type, firstBytes)) {
      return this.reject(asset.id, 'MEDIA_CONTENT_MISMATCH', 'Isi file bukan media sesuai tipe yang dijanjikan.');
    }

    const updated = await this.db.query<{ id: string }>(
      `UPDATE media_assets SET status = 'ready', ready_at = now(), size_bytes = $2
       WHERE id = $1 AND status = 'pending' AND upload_expires_at > now()
       RETURNING id`,
      [asset.id, read],
    );
    if (!updated[0]) {
      const current = await this.db.query<{ status: string }>(`SELECT status FROM media_assets WHERE id = $1`, [asset.id]);
      if (current[0]?.status === 'ready') return { id: asset.id, status: 'ready', purpose: asset.purpose, duplicate: true };
      throw new ConflictException({ code: 'MEDIA_NOT_PENDING', title: 'Media tidak dapat diselesaikan', detail: 'Status aset berubah selama verifikasi.' });
    }
    return { id: asset.id, status: 'ready', purpose: asset.purpose };
  }

  /** Returns the row only when this viewer may see the media, otherwise 404. */
  async accessible(userId: string, mediaId: string): Promise<MediaAssetRow> {
    const rows = await this.db.query<MediaAssetRow & { viewer_may_see: boolean }>(
      `SELECT m.id, m.owner_id, m.purpose, m.mime_type, m.size_bytes, m.object_key,
              m.status, m.moderation_status, m.album_id, m.post_id, m.width, m.height,
              m.duration_s, m.taken_at, m.caption, m.sort_index,
              (m.owner_id = $2 OR (
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
   * Mint a short-lived GET grant. No storage key is exposed without a valid
   * signature, and the signature is bound to one media id and one expiry.
   */
  async signGet(userId: string, mediaId: string, ttlSeconds = this.config.mediaSignedUrlTtlSeconds) {
    const asset = await this.accessible(userId, mediaId);
    const expires = Math.floor(Date.now() / 1000) + ttlSeconds;
    const signature = this.signature(asset.id, expires);
    return {
      id: asset.id,
      mimeType: asset.mime_type,
      sizeBytes: asset.size_bytes,
      expiresAt: new Date(expires * 1000).toISOString(),
      expiresIn: ttlSeconds,
      url: `/v1/media/${asset.id}/access?expires=${expires}&signature=${encodeURIComponent(signature)}`,
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
      `SELECT id, mime_type, size_bytes, object_key, purpose, status FROM media_assets
       WHERE id = $1 AND status = 'ready'`,
      [mediaId],
    );
    if (!rows[0]) throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', title: 'Media tidak ditemukan', detail: 'Media tidak tersedia.' });
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
