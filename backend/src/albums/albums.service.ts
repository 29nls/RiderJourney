import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE, type Database } from '../db/database.js';
import { PlanService } from '../entitlements/plan.service.js';
import { audienceAllowed } from '../social/audience.sql.js';
import { communityPermission } from '../social/community-permissions.js';
import type {
  AddAlbumMediaDto, AlbumListQueryDto, CreateAlbumDto, ReviewAlbumMediaDto, UpdateAlbumMediaDto,
} from './albums.dto.js';

type AlbumRow = {
  id: string;
  owner_id: string;
  community_id: string | null;
  title: string;
  description: string | null;
  visibility: string;
  cover_media_id: string | null;
  quota_bytes: string | number;
  used_bytes: string | number;
  created_at: Date;
  updated_at: Date;
  username?: string;
  display_name?: string;
};

type AlbumMediaRow = {
  id: string;
  owner_id: string;
  mime_type: string;
  size_bytes: number;
  status: string;
  moderation_status: string;
  width: number | null;
  height: number | null;
  duration_s: number | null;
  taken_at: Date | null;
  caption: string | null;
  sort_index: number;
  created_at: Date;
};

const ALBUM_VISIBILITY = { author: 'a.owner_id', audience: 'a.visibility', community: 'a.community_id' };

function encodeCursor(createdAt: Date, id: string): string {
  return Buffer.from(JSON.stringify({ createdAt: createdAt.toISOString(), id }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): { createdAt: Date; id: string } {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { createdAt?: string; id?: string };
    const createdAt = new Date(parsed.createdAt ?? '');
    if (Number.isNaN(createdAt.getTime()) || !parsed.id) throw new Error('invalid');
    return { createdAt, id: parsed.id };
  } catch {
    throw new BadRequestException({ code: 'INVALID_CURSOR', title: 'Cursor tidak valid', detail: 'Cursor pagination tidak valid.' });
  }
}

@Injectable()
export class AlbumsService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    private readonly plans: PlanService,
  ) {}

  private presentAlbum(row: AlbumRow, media: AlbumMediaRow[]) {
    return {
      id: row.id,
      ownerId: row.owner_id,
      communityId: row.community_id,
      title: row.title,
      description: row.description,
      visibility: row.visibility,
      coverMediaId: row.cover_media_id,
      quotaBytes: Number(row.quota_bytes),
      usedBytes: Number(row.used_bytes),
      createdAt: new Date(row.created_at).toISOString(),
      updatedAt: new Date(row.updated_at).toISOString(),
      media: media.map((item) => ({
        id: item.id,
        mimeType: item.mime_type,
        sizeBytes: item.size_bytes,
        moderationStatus: item.moderation_status,
        width: item.width,
        height: item.height,
        durationS: item.duration_s,
        takenAt: item.taken_at ? new Date(item.taken_at).toISOString() : null,
        caption: item.caption,
        sortIndex: item.sort_index,
        signedUrlPath: `/v1/media/${item.id}/url`,
      })),
    };
  }

  async create(userId: string, dto: CreateAlbumDto) {
    const duplicate = await this.db.query<{ id: string }>(
      `SELECT id FROM albums WHERE owner_id = $1 AND client_album_id = $2`,
      [userId, dto.clientAlbumId],
    );
    if (duplicate[0]) return { ...(await this.one(userId, duplicate[0].id)), duplicate: true };

    if (dto.visibility === 'community') {
      if (!dto.communityId) {
        throw new UnprocessableEntityException({ code: 'COMMUNITY_REQUIRED', title: 'Komunitas wajib diisi', detail: 'Album komunitas membutuhkan communityId.' });
      }
      const permission = await communityPermission(this.db, dto.communityId, userId, 'album.create');
      if (!permission.allowed) {
        throw new ForbiddenException({ code: 'ALBUM_FORBIDDEN', title: 'Tidak dapat membuat album komunitas', detail: 'Keanggotaan aktif atau izin album.create diperlukan.' });
      }
    } else if (dto.communityId) {
      throw new UnprocessableEntityException({ code: 'COMMUNITY_AUDIENCE_MISMATCH', title: 'Visibilitas tidak cocok', detail: 'communityId hanya dipakai bersama visibilitas komunitas.' });
    }

    const id = uuidv7();
    const quota = (await this.plans.limits(userId)).albumQuotaBytes;
    await this.db.query(
      `INSERT INTO albums (id, owner_id, community_id, title, description, visibility, quota_bytes, client_album_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8)`,
      [id, userId, dto.communityId ?? null, dto.title, dto.description ?? null, dto.visibility, quota, dto.clientAlbumId],
    );
    return { ...(await this.one(userId, id)), duplicate: false };
  }

  async one(viewerId: string, albumId: string) {
    const rows = await this.db.query<AlbumRow & { username: string; display_name: string }>(
      `SELECT a.*, u.username, u.display_name
       FROM albums a JOIN users u ON u.id = a.owner_id
       WHERE a.id = $4 AND a.deleted_at IS NULL
         AND ${audienceAllowed(ALBUM_VISIBILITY)}`,
      [viewerId, false, null, albumId],
    );
    const album = rows[0];
    if (!album) throw new NotFoundException({ code: 'ALBUM_NOT_FOUND', title: 'Album tidak ditemukan', detail: 'Album tidak tersedia untuk akun ini.' });
    const media = await this.db.query<AlbumMediaRow>(
      `SELECT id, owner_id, mime_type, size_bytes, status, moderation_status, width, height,
              duration_s, taken_at, caption, sort_index, created_at
       FROM media_assets
       WHERE album_id = $1 AND status = 'ready'
         AND (moderation_status <> 'rejected' OR owner_id = $2)
       ORDER BY sort_index ASC, created_at ASC`,
      [albumId, viewerId],
    );
    return { ...this.presentAlbum(album, media), owner: { id: album.owner_id, username: album.username, displayName: album.display_name } };
  }

  async mine(userId: string, query: AlbumListQueryDto) {
    const limit = query.limit ?? 20;
    const before = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.db.query<AlbumRow>(
      `SELECT * FROM albums
       WHERE owner_id = $1 AND deleted_at IS NULL
         AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::uuid))
       ORDER BY created_at DESC, id DESC LIMIT $2`,
      [userId, limit + 1, before?.createdAt ?? null, before?.id ?? null],
    );
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => this.presentAlbum(row, [])),
      nextCursor: rows.length > limit ? encodeCursor(new Date(page[page.length - 1].created_at), page[page.length - 1].id) : null,
    };
  }

  async forCommunity(userId: string, communityId: string, query: AlbumListQueryDto) {
    const member = await this.db.query<{ role: string }>(
      `SELECT role FROM community_members WHERE community_id = $1 AND user_id = $2 AND status = 'active'`,
      [communityId, userId],
    );
    if (!member[0]) throw new NotFoundException({ code: 'COMMUNITY_NOT_FOUND', title: 'Komunitas tidak ditemukan', detail: 'Album komunitas hanya untuk anggota aktif.' });
    const limit = query.limit ?? 20;
    const before = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.db.query<AlbumRow>(
      `SELECT * FROM albums
       WHERE community_id = $1 AND deleted_at IS NULL
         AND ($3::timestamptz IS NULL OR (created_at, id) < ($3::timestamptz, $4::uuid))
       ORDER BY created_at DESC, id DESC LIMIT $2`,
      [communityId, limit + 1, before?.createdAt ?? null, before?.id ?? null],
    );
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => this.presentAlbum(row, [])),
      nextCursor: rows.length > limit ? encodeCursor(new Date(page[page.length - 1].created_at), page[page.length - 1].id) : null,
    };
  }

  private async canManage(userId: string, album: AlbumRow): Promise<boolean> {
    if (album.owner_id === userId) return true;
    if (!album.community_id) return false;
    const permission = await communityPermission(this.db, album.community_id, userId, 'album.create');
    return permission.allowed;
  }

  private async isCommunityModerator(userId: string, communityId: string): Promise<boolean> {
    const rows = await this.db.query<{ role: string }>(
      `SELECT role FROM community_members
       WHERE community_id = $1 AND user_id = $2 AND status = 'active' AND role IN ('owner', 'admin', 'moderator')`,
      [communityId, userId],
    );
    return rows.length > 0;
  }

  async addMedia(userId: string, albumId: string, dto: AddAlbumMediaDto) {
    const outcome = await this.db.transaction(async (tx) => {
      const albums = await tx.query<AlbumRow>(`SELECT * FROM albums WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [albumId]);
      const album = albums[0];
      if (!album) throw new NotFoundException({ code: 'ALBUM_NOT_FOUND', title: 'Album tidak ditemukan', detail: 'Album tidak tersedia.' });
      if (!(await this.canManage(userId, album))) {
        throw new ForbiddenException({ code: 'ALBUM_FORBIDDEN', title: 'Tidak dapat mengubah album', detail: 'Hanya pemilik album atau pengelola komunitas yang dapat menambah media.' });
      }
      const mediaRows = await tx.query<AlbumMediaRow>(
        `SELECT * FROM media_assets WHERE id = $1 AND status = 'ready'`,
        [dto.mediaId],
      );
      const media = mediaRows[0];
      if (!media || media.owner_id !== userId) {
        throw new UnprocessableEntityException({ code: 'MEDIA_NOT_ATTACHABLE', title: 'Media tidak dapat dilampirkan', detail: 'Media harus milik akun ini dan sudah selesai diunggah.' });
      }
      if (!['album_photo', 'album_video'].includes(String((media as unknown as { purpose: string }).purpose))) {
        throw new UnprocessableEntityException({ code: 'MEDIA_NOT_ATTACHABLE', title: 'Media tidak dapat dilampirkan', detail: 'Gunakan media yang diunggah untuk album.' });
      }
      if ((media as unknown as { album_id: string | null }).album_id === albumId) {
        return { duplicate: true };
      }
      if ((media as unknown as { album_id: string | null }).album_id || (media as unknown as { post_id: string | null }).post_id) {
        throw new ConflictException({ code: 'MEDIA_ALREADY_ATTACHED', title: 'Media sudah dipakai', detail: 'Satu media hanya dapat berada di satu album atau postingan.' });
      }
      const quota = Number(album.quota_bytes);
      const used = Number(album.used_bytes);
      if (used + media.size_bytes > quota) {
        throw new ConflictException({ code: 'ALBUM_QUOTA_EXCEEDED', title: 'Kuota album penuh', detail: `Sisa kuota ${quota - used} byte.` });
      }
      const position = await tx.query<{ next: number }>(
        `SELECT COALESCE(max(sort_index) + 1, 0) AS next FROM media_assets WHERE album_id = $1 AND status <> 'deleted'`,
        [albumId],
      );
      await tx.query(
        `UPDATE media_assets SET album_id = $2, sort_index = $3, caption = $4, taken_at = $5,
           width = $6, height = $7, duration_s = $8,
           moderation_status = CASE WHEN $9::uuid IS NULL THEN 'approved' ELSE 'pending' END
         WHERE id = $1`,
        [
          dto.mediaId, albumId, dto.sortIndex ?? position[0]?.next ?? 0, dto.caption ?? null,
          dto.takenAt ?? null, dto.width ?? null, dto.height ?? null, dto.durationS ?? null,
          album.community_id,
        ],
      );
      await tx.query(`UPDATE albums SET used_bytes = used_bytes + $2, updated_at = now() WHERE id = $1`, [albumId, media.size_bytes]);
      return { duplicate: false };
    });
    return { ...(await this.one(userId, albumId)), duplicate: outcome.duplicate };
  }

  async updateMedia(userId: string, albumId: string, mediaId: string, dto: UpdateAlbumMediaDto) {
    const albums = await this.db.query<AlbumRow>(`SELECT * FROM albums WHERE id = $1 AND deleted_at IS NULL`, [albumId]);
    const album = albums[0];
    if (!album) throw new NotFoundException({ code: 'ALBUM_NOT_FOUND', title: 'Album tidak ditemukan', detail: 'Album tidak tersedia.' });
    if (!(await this.canManage(userId, album))) {
      throw new ForbiddenException({ code: 'ALBUM_FORBIDDEN', title: 'Tidak dapat mengubah album', detail: 'Hanya pemilik album atau pengelola komunitas yang dapat mengubah metadata.' });
    }
    await this.db.query(
      `UPDATE media_assets SET caption = COALESCE($3, caption), taken_at = COALESCE($4, taken_at)
       WHERE id = $1 AND album_id = $2 AND status = 'ready'`,
      [mediaId, albumId, dto.caption ?? null, dto.takenAt ?? null],
    );
    return this.one(userId, albumId);
  }

  async reviewMedia(userId: string, albumId: string, mediaId: string, dto: ReviewAlbumMediaDto) {
    const albums = await this.db.query<AlbumRow>(`SELECT * FROM albums WHERE id = $1 AND deleted_at IS NULL`, [albumId]);
    const album = albums[0];
    if (!album) throw new NotFoundException({ code: 'ALBUM_NOT_FOUND', title: 'Album tidak ditemukan', detail: 'Album tidak tersedia.' });
    const canReview = album.owner_id === userId || (album.community_id ? await this.isCommunityModerator(userId, album.community_id) : false);
    if (!canReview) {
      throw new ForbiddenException({ code: 'REVIEW_FORBIDDEN', title: 'Tidak dapat meninjau media', detail: 'Hanya pemilik album atau moderator komunitas yang dapat meninjau.' });
    }
    const rows = await this.db.query<{ id: string }>(
      `UPDATE media_assets SET moderation_status = $3
       WHERE id = $1 AND album_id = $2 AND status = 'ready' RETURNING id`,
      [mediaId, albumId, dto.status],
    );
    if (!rows[0]) throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', title: 'Media tidak ditemukan', detail: 'Media bukan bagian dari album ini.' });
    return { mediaId, albumId, moderationStatus: dto.status };
  }

  async removeMedia(userId: string, albumId: string, mediaId: string) {
    const outcome = await this.db.transaction(async (tx) => {
      const albums = await tx.query<AlbumRow>(`SELECT * FROM albums WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [albumId]);
      const album = albums[0];
      if (!album) throw new NotFoundException({ code: 'ALBUM_NOT_FOUND', title: 'Album tidak ditemukan', detail: 'Album tidak tersedia.' });
      const mediaRows = await tx.query<AlbumMediaRow>(`SELECT * FROM media_assets WHERE id = $1 AND album_id = $2`, [mediaId, albumId]);
      const media = mediaRows[0];
      if (!media) throw new NotFoundException({ code: 'MEDIA_NOT_FOUND', title: 'Media tidak ditemukan', detail: 'Media bukan bagian dari album ini.' });
      if (!(await this.canManage(userId, album)) && media.owner_id !== userId) {
        throw new ForbiddenException({ code: 'ALBUM_FORBIDDEN', title: 'Tidak dapat menghapus media', detail: 'Hanya pemilik album atau pengunggah media yang dapat menghapus.' });
      }
      await tx.query(
        `UPDATE media_assets SET status = 'deleted', album_id = NULL, sort_index = 0 WHERE id = $1`,
        [mediaId],
      );
      await tx.query(
        `UPDATE albums SET used_bytes = GREATEST(0, used_bytes - $2), updated_at = now() WHERE id = $1`,
        [albumId, media.size_bytes],
      );
      return { mediaId, albumId, deleted: true };
    });
    return outcome;
  }

  async removeAlbum(userId: string, albumId: string) {
    return this.db.transaction(async (tx) => {
      const albums = await tx.query<AlbumRow>(`SELECT * FROM albums WHERE id = $1 AND deleted_at IS NULL FOR UPDATE`, [albumId]);
      const album = albums[0];
      if (!album) throw new NotFoundException({ code: 'ALBUM_NOT_FOUND', title: 'Album tidak ditemukan', detail: 'Album tidak tersedia.' });
      if (album.owner_id !== userId) {
        throw new ForbiddenException({ code: 'ALBUM_FORBIDDEN', title: 'Tidak dapat menghapus album', detail: 'Hanya pemilik album yang dapat menghapus.' });
      }
      const media = await tx.query<{ id: string; object_key: string }>(
        `SELECT id, object_key FROM media_assets WHERE album_id = $1`,
        [albumId],
      );
      await tx.query(`UPDATE media_assets SET status = 'deleted', album_id = NULL, sort_index = 0 WHERE album_id = $1`, [albumId]);
      await tx.query(`UPDATE albums SET deleted_at = now(), used_bytes = 0, updated_at = now() WHERE id = $1`, [albumId]);
      return { id: albumId, deleted: true, mediaCount: media.length, objectKeys: media.map((row) => row.object_key) };
    });
  }
}
