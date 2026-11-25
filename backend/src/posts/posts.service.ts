import {
  BadRequestException, ForbiddenException, HttpException, HttpStatus, Inject, Injectable,
  NotFoundException, UnprocessableEntityException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.js';
import { REALTIME_STORE, type RealtimeStore } from '../realtime/realtime.store.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { audienceAllowed } from '../social/audience.sql.js';
import { communityPermission } from '../social/community-permissions.js';
import type { CreatePostDto, PostListQueryDto, ReactDto } from './posts.dto.js';
import { hashtagsOf, mentionsOf, recordHashtags, recordMentions } from './posts.taxonomy.js';

type PostRow = {
  id: string;
  author_id: string;
  kind: string;
  audience: string;
  community_id: string | null;
  trip_id: string | null;
  caption: string | null;
  created_at: Date;
  username: string;
  display_name: string;
  avatar_media_id: string | null;
  reaction_count: number;
  comment_count: number;
  viewer_reaction: string | null;
  saved: boolean;
  media: Array<{
    id: string; mimeType: string; width: number | null; height: number | null;
    durationS: number | null; sortIndex: number; altText: string | null;
  }> | null;
};

const VISIBILITY = { author: 'p.author_id', audience: 'p.audience', community: 'p.community_id' };

const POST_SELECT = `
  SELECT p.id, p.author_id, p.kind, p.audience, p.community_id, p.trip_id, p.caption,
         p.created_at, u.username, u.display_name, rp.avatar_media_id,
         (SELECT count(*) FROM reactions r WHERE r.post_id = p.id)::int AS reaction_count,
         (SELECT count(*) FROM comments c WHERE c.post_id = p.id AND c.deleted_at IS NULL)::int AS comment_count,
         (SELECT r.kind FROM reactions r WHERE r.post_id = p.id AND r.user_id = $1) AS viewer_reaction,
         EXISTS (SELECT 1 FROM post_saves s WHERE s.post_id = p.id AND s.user_id = $1) AS saved,
         COALESCE((
           SELECT json_agg(json_build_object(
             'id', m.id, 'mimeType', m.mime_type, 'width', m.width, 'height', m.height,
             'durationS', m.duration_s, 'sortIndex', pm.sort_index, 'altText', pm.alt_text
           ) ORDER BY pm.sort_index)
           FROM post_media pm JOIN media_assets m ON m.id = pm.media_id
           WHERE pm.post_id = p.id AND m.status = 'ready'
         ), '[]'::json) AS media
  FROM posts p
  JOIN users u ON u.id = p.author_id
  LEFT JOIN rider_profiles rp ON rp.user_id = p.author_id`;

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
export class PostsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REALTIME_STORE) private readonly store: RealtimeStore,
    private readonly notifications: NotificationsService,
  ) {}

  private present(row: PostRow) {
    return {
      id: row.id,
      kind: row.kind,
      audience: row.audience,
      communityId: row.community_id,
      tripId: row.trip_id,
      caption: row.caption,
      author: {
        id: row.author_id,
        username: row.username,
        displayName: row.display_name,
        avatarMediaId: row.avatar_media_id,
      },
      media: row.media ?? [],
      reactionCount: row.reaction_count,
      commentCount: row.comment_count,
      viewerReaction: row.viewer_reaction,
      saved: row.saved,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  /** One rule for every read path: audience plus a block in either direction. */
  async assertVisible(viewerId: string, postId: string): Promise<PostRow> {
    const rows = await this.db.query<PostRow>(
      `${POST_SELECT}
       WHERE p.id = $4 AND p.status = 'published' AND p.deleted_at IS NULL
         AND ${audienceAllowed(VISIBILITY)}
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
           WHERE (b.blocker_id = $1 AND b.blocked_id = p.author_id)
              OR (b.blocker_id = p.author_id AND b.blocked_id = $1)
         )`,
      [viewerId, false, 'published', postId],
    );
    if (!rows[0]) {
      throw new NotFoundException({ code: 'POST_NOT_FOUND', title: 'Postingan tidak ditemukan', detail: 'Postingan tidak tersedia untuk akun ini.' });
    }
    return rows[0];
  }

  private async page(viewerId: string, limit: number, cursor: string | undefined, extraWhere = '', extraParams: unknown[] = []) {
    const before = cursor ? decodeCursor(cursor) : null;
    const rows = await this.db.query<PostRow>(
      `${POST_SELECT}
       WHERE p.status = 'published' AND p.deleted_at IS NULL
         AND ${audienceAllowed(VISIBILITY)}
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
           WHERE (b.blocker_id = $1 AND b.blocked_id = p.author_id)
              OR (b.blocker_id = p.author_id AND b.blocked_id = $1)
         )
         AND NOT EXISTS (SELECT 1 FROM user_mutes m WHERE m.muter_id = $1 AND m.muted_id = p.author_id)
         AND ($4::timestamptz IS NULL OR (p.created_at, p.id) < ($4::timestamptz, $5::uuid))
         ${extraWhere}
       ORDER BY p.created_at DESC, p.id DESC
       LIMIT $6`,
      [viewerId, false, 'published', before?.createdAt ?? null, before?.id ?? null, limit + 1, ...extraParams],
    );
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => this.present(row)),
      nextCursor: rows.length > limit ? encodeCursor(new Date(page[page.length - 1].created_at), page[page.length - 1].id) : null,
    };
  }

  feed(userId: string, query: PostListQueryDto) {
    return this.page(userId, query.limit ?? 20, query.cursor);
  }

  authorPosts(viewerId: string, authorId: string, query: PostListQueryDto) {
    return this.page(viewerId, query.limit ?? 20, query.cursor, 'AND p.author_id = $7', [authorId]);
  }

  tagged(viewerId: string, tag: string, query: PostListQueryDto) {
    return this.page(
      viewerId, query.limit ?? 20, query.cursor,
      'AND EXISTS (SELECT 1 FROM post_hashtags ph WHERE ph.post_id = p.id AND ph.tag = $7)',
      [tag.toLowerCase()],
    );
  }

  saved(viewerId: string, query: PostListQueryDto) {
    return this.page(
      viewerId, query.limit ?? 20, query.cursor,
      'AND EXISTS (SELECT 1 FROM post_saves ps WHERE ps.post_id = p.id AND ps.user_id = $1)',
    );
  }

  async get(viewerId: string, postId: string) {
    return this.present(await this.assertVisible(viewerId, postId));
  }

  async create(userId: string, dto: CreatePostDto) {
    const duplicate = await this.db.query<{ id: string }>(
      `SELECT id FROM posts WHERE author_id = $1 AND client_post_id = $2`,
      [userId, dto.clientPostId],
    );
    if (duplicate[0]) return { ...(await this.detailForOwner(userId, duplicate[0].id)), duplicate: true };

    if (dto.kind === 'text' && dto.mediaIds?.length) {
      throw new UnprocessableEntityException({ code: 'MEDIA_NOT_ALLOWED', title: 'Media tidak sesuai', detail: 'Postingan teks tidak melampirkan media.' });
    }
    if ((dto.kind === 'photo' || dto.kind === 'video') && !dto.mediaIds?.length) {
      throw new UnprocessableEntityException({ code: 'MEDIA_REQUIRED', title: 'Media wajib diisi', detail: 'Postingan foto atau video membutuhkan minimal satu media.' });
    }
    if (dto.kind === 'trip_recap' && !dto.tripId) {
      throw new UnprocessableEntityException({ code: 'TRIP_REQUIRED', title: 'Trip wajib diisi', detail: 'Postingan rekap perjalanan membutuhkan tripId.' });
    }
    if (dto.audience === 'community') {
      if (!dto.communityId) {
        throw new UnprocessableEntityException({ code: 'COMMUNITY_REQUIRED', title: 'Komunitas wajib diisi', detail: 'Audience komunitas membutuhkan communityId.' });
      }
      const permission = await communityPermission(this.db, dto.communityId, userId, 'post.create');
      if (!permission.allowed) {
        throw new ForbiddenException({ code: 'COMMUNITY_POST_FORBIDDEN', title: 'Tidak dapat memposting di komunitas', detail: 'Keanggotaan aktif atau izin post.create diperlukan.' });
      }
    } else if (dto.communityId) {
      throw new UnprocessableEntityException({ code: 'COMMUNITY_AUDIENCE_MISMATCH', title: 'Audience tidak cocok', detail: 'communityId hanya dipakai bersama audience komunitas.' });
    }

    if (dto.tripId) {
      const trip = await this.db.query<{ id: string; status: string }>(
        `SELECT id, status FROM trips WHERE id = $1 AND user_id = $2`,
        [dto.tripId, userId],
      );
      if (!trip[0]) throw new NotFoundException({ code: 'TRIP_NOT_FOUND', title: 'Perjalanan tidak ditemukan', detail: 'Perjalanan bukan milik akun ini.' });
      if (dto.kind === 'trip_recap' && trip[0].status !== 'finished') {
        throw new UnprocessableEntityException({ code: 'TRIP_NOT_FINISHED', title: 'Perjalanan belum selesai', detail: 'Rekap hanya dapat dibuat dari perjalanan yang selesai.' });
      }
    }

    const hourly = await this.store.incrementRateLimit(`post:${userId}`, 3600);
    if (hourly > this.config.postRateLimitPerHour) {
      throw new HttpException(
        { code: 'POST_RATE_LIMITED', title: 'Terlalu banyak postingan', detail: 'Batas postingan per jam tercapai.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    const postId = uuidv7();
    const mediaIds = [...new Set(dto.mediaIds ?? [])];
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO posts (id, author_id, kind, audience, community_id, trip_id, caption, location_ref, client_post_id)
         VALUES ($1, $2, $3, $4, $5, $6, $7,
           CASE WHEN $8::float8 IS NULL THEN NULL ELSE ST_SetSRID(ST_MakePoint($9, $8), 4326)::geography END,
           $10)`,
        [
          postId, userId, dto.kind, dto.audience, dto.communityId ?? null, dto.tripId ?? null,
          dto.caption ?? null, dto.location?.lat ?? null, dto.location?.lng ?? null, dto.clientPostId,
        ],
      );
      const expected = dto.kind === 'video' ? ['post_video'] : ['post_photo'];
      for (const [index, mediaId] of mediaIds.entries()) {
        const asset = await tx.query<{ id: string; purpose: string; post_id: string | null }>(
          `SELECT id, purpose, post_id FROM media_assets WHERE id = $1 AND owner_id = $2 AND status = 'ready'`,
          [mediaId, userId],
        );
        if (!asset[0] || !expected.includes(asset[0].purpose) || asset[0].post_id) {
          throw new UnprocessableEntityException({ code: 'MEDIA_NOT_ATTACHABLE', title: 'Media tidak dapat dilampirkan', detail: 'Media harus milik akun ini, sudah selesai diunggah, dan belum dipakai postingan lain.' });
        }
        await tx.query(`INSERT INTO post_media (post_id, media_id, sort_index) VALUES ($1, $2, $3)`, [postId, mediaId, index]);
        await tx.query(`UPDATE media_assets SET post_id = $2, sort_index = $3 WHERE id = $1`, [mediaId, postId, index]);
      }
      await recordHashtags(tx, postId, hashtagsOf(dto.caption));
      await recordMentions(tx, { postId, usernames: mentionsOf(dto.caption) });
    });

    for (const mentioned of await this.mentionedUsers(postId)) {
      await this.notifications.create({
        userId: mentioned.id,
        kind: 'mention',
        threadKey: `mention:post:${postId}:${mentioned.id}`,
        sourceUserId: userId,
        postId,
        payload: { message: 'Kamu disebut dalam sebuah postingan', postId },
      });
    }
    return { ...(await this.detailForOwner(userId, postId)), duplicate: false };
  }

  private async mentionedUsers(postId: string) {
    return this.db.query<{ id: string }>(
      `SELECT DISTINCT mentioned_id AS id FROM mentions WHERE post_id = $1 AND comment_id IS NULL`,
      [postId],
    );
  }

  private async detailForOwner(userId: string, postId: string) {
    const rows = await this.db.query<PostRow>(
      `${POST_SELECT} WHERE p.id = $2 AND p.author_id = $1`,
      [userId, postId],
    );
    if (!rows[0]) throw new NotFoundException({ code: 'POST_NOT_FOUND', title: 'Postingan tidak ditemukan', detail: 'Postingan tidak tersedia.' });
    return this.present(rows[0]);
  }

  async react(userId: string, postId: string, dto: ReactDto) {
    await this.assertVisible(userId, postId);
    const existing = await this.db.query<{ kind: string; client_id: string }>(
      `SELECT kind, client_id FROM reactions WHERE post_id = $1 AND user_id = $2`,
      [postId, userId],
    );
    if (existing[0]) {
      if (existing[0].kind === dto.kind) {
        return { postId, kind: dto.kind, duplicate: true, active: true };
      }
      await this.db.query(
        `UPDATE reactions SET kind = $3, client_id = $4, created_at = now() WHERE post_id = $1 AND user_id = $2`,
        [postId, userId, dto.kind, dto.clientId],
      );
      return { postId, kind: dto.kind, duplicate: false, active: true };
    }
    await this.db.query(
      `INSERT INTO reactions (post_id, user_id, kind, client_id) VALUES ($1, $2, $3, $4)`,
      [postId, userId, dto.kind, dto.clientId],
    );
    const post = await this.db.query<{ author_id: string }>(`SELECT author_id FROM posts WHERE id = $1`, [postId]);
    if (post[0]) {
      await this.notifications.create({
        userId: post[0].author_id,
        kind: 'like',
        threadKey: `like:${postId}`,
        sourceUserId: userId,
        postId,
        payload: { message: 'Seseorang menyukai postinganmu', postId },
      });
    }
    return { postId, kind: dto.kind, duplicate: false, active: true };
  }

  async unreact(userId: string, postId: string) {
    await this.assertVisible(userId, postId);
    const rows = await this.db.query<{ post_id: string }>(
      `DELETE FROM reactions WHERE post_id = $1 AND user_id = $2 RETURNING post_id`,
      [postId, userId],
    );
    return { postId, active: false, removed: rows.length > 0 };
  }

  async save(userId: string, postId: string) {
    await this.assertVisible(userId, postId);
    await this.db.query(`INSERT INTO post_saves (post_id, user_id) VALUES ($1, $2) ON CONFLICT DO NOTHING`, [postId, userId]);
    return { postId, saved: true };
  }

  async unsave(userId: string, postId: string) {
    await this.db.query(`DELETE FROM post_saves WHERE post_id = $1 AND user_id = $2`, [postId, userId]);
    return { postId, saved: false };
  }

  async remove(userId: string, postId: string) {
    const rows = await this.db.query<{ id: string; author_id: string; community_id: string | null }>(
      `SELECT id, author_id, community_id FROM posts WHERE id = $1`,
      [postId],
    );
    const post = rows[0];
    if (!post) throw new NotFoundException({ code: 'POST_NOT_FOUND', title: 'Postingan tidak ditemukan', detail: 'Postingan tidak tersedia.' });
    let allowed = post.author_id === userId;
    if (!allowed && post.community_id) {
      const permission = await communityPermission(this.db, post.community_id, userId, 'post.remove_any');
      allowed = permission.allowed;
    }
    if (!allowed) throw new NotFoundException({ code: 'POST_NOT_FOUND', title: 'Postingan tidak ditemukan', detail: 'Postingan tidak tersedia.' });
    await this.db.transaction(async (tx) => {
      await tx.query(`UPDATE posts SET status = 'deleted', deleted_at = now(), updated_at = now() WHERE id = $1`, [postId]);
      await tx.query(
        `UPDATE hashtags h SET post_count = GREATEST(0, h.post_count - 1)
         FROM post_hashtags ph WHERE ph.post_id = $1 AND ph.tag = h.tag`,
        [postId],
      );
      await tx.query(`DELETE FROM post_hashtags WHERE post_id = $1`, [postId]);
    });
    return { id: postId, deleted: true };
  }
}
