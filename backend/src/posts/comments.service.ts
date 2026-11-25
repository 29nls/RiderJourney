import {
  BadRequestException, HttpException, HttpStatus, Inject, Injectable, NotFoundException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { REALTIME_STORE, type RealtimeStore } from '../realtime/realtime.store.js';
import { communityPermission } from '../social/community-permissions.js';
import type { CommentReactionDto, CreateCommentDto, PostListQueryDto } from './posts.dto.js';
import { PostsService } from './posts.service.js';
import { mentionsOf, recordMentions } from './posts.taxonomy.js';

type CommentRow = {
  id: string;
  post_id: string;
  author_id: string;
  parent_id: string | null;
  body: string;
  created_at: Date;
  username: string;
  display_name: string;
  avatar_media_id: string | null;
  reaction_count: number;
  viewer_reaction: string | null;
};

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
export class CommentsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REALTIME_STORE) private readonly store: RealtimeStore,
    private readonly posts: PostsService,
    private readonly notifications: NotificationsService,
  ) {}

  private present(row: CommentRow) {
    return {
      id: row.id,
      postId: row.post_id,
      parentId: row.parent_id,
      body: row.body,
      author: {
        id: row.author_id,
        username: row.username,
        displayName: row.display_name,
        avatarMediaId: row.avatar_media_id,
      },
      reactionCount: row.reaction_count,
      viewerReaction: row.viewer_reaction,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async list(viewerId: string, postId: string, query: PostListQueryDto) {
    await this.posts.assertVisible(viewerId, postId);
    const limit = query.limit ?? 20;
    const before = query.cursor ? decodeCursor(query.cursor) : null;
    const rows = await this.db.query<CommentRow>(
      `SELECT c.id, c.post_id, c.author_id, c.parent_id, c.body, c.created_at,
              u.username, u.display_name, rp.avatar_media_id,
              (SELECT count(*) FROM comment_reactions cr WHERE cr.comment_id = c.id)::int AS reaction_count,
              (SELECT cr.kind FROM comment_reactions cr WHERE cr.comment_id = c.id AND cr.user_id = $1) AS viewer_reaction
       FROM comments c
       JOIN users u ON u.id = c.author_id
       LEFT JOIN rider_profiles rp ON rp.user_id = c.author_id
       WHERE c.post_id = $2 AND c.deleted_at IS NULL
         AND ($4::timestamptz IS NULL OR (c.created_at, c.id) > ($4::timestamptz, $5::uuid))
       ORDER BY c.created_at ASC, c.id ASC
       LIMIT $3`,
      [viewerId, postId, limit + 1, before?.createdAt ?? null, before?.id ?? null],
    );
    const page = rows.slice(0, limit);
    return {
      items: page.map((row) => this.present(row)),
      nextCursor: rows.length > limit ? encodeCursor(new Date(page[page.length - 1].created_at), page[page.length - 1].id) : null,
    };
  }

  async create(userId: string, postId: string, dto: CreateCommentDto) {
    const post = await this.posts.assertVisible(userId, postId);
    const hourly = await this.store.incrementRateLimit(`comment:${userId}`, 3600);
    if (hourly > this.config.commentRateLimitPerHour) {
      throw new HttpException(
        { code: 'COMMENT_RATE_LIMITED', title: 'Terlalu banyak komentar', detail: 'Batas komentar per jam tercapai.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const duplicate = await this.db.query<{ id: string }>(
      `SELECT id FROM comments WHERE post_id = $1 AND author_id = $2 AND client_id = $3`,
      [postId, userId, dto.clientId],
    );
    if (duplicate[0]) {
      const rows = await this.one(userId, duplicate[0].id);
      return { ...this.present(rows), duplicate: true };
    }
    if (dto.parentId) {
      const parent = await this.db.query<{ id: string }>(
        `SELECT id FROM comments WHERE id = $1 AND post_id = $2 AND deleted_at IS NULL`,
        [dto.parentId, postId],
      );
      if (!parent[0]) throw new NotFoundException({ code: 'COMMENT_NOT_FOUND', title: 'Komentar induk tidak ditemukan', detail: 'Balasan harus menunjuk komentar pada postingan yang sama.' });
    }

    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO comments (id, post_id, author_id, parent_id, client_id, body)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, postId, userId, dto.parentId ?? null, dto.clientId, dto.body],
      );
      await recordMentions(tx, { postId, commentId: id, usernames: mentionsOf(dto.body) });
    });

    await this.notifications.create({
      userId: post.author_id,
      kind: 'comment',
      threadKey: `comment:${postId}:${id}`,
      sourceUserId: userId,
      postId,
      commentId: id,
      payload: { message: 'Seseorang mengomentari postinganmu', postId, commentId: id },
    });
    const mentioned = await this.db.query<{ id: string }>(`SELECT DISTINCT mentioned_id AS id FROM mentions WHERE comment_id = $1`, [id]);
    for (const user of mentioned) {
      await this.notifications.create({
        userId: user.id,
        kind: 'mention',
        threadKey: `mention:comment:${id}:${user.id}`,
        sourceUserId: userId,
        postId,
        commentId: id,
        payload: { message: 'Kamu disebut dalam sebuah komentar', postId, commentId: id },
      });
    }
    return { ...this.present(await this.one(userId, id)), duplicate: false };
  }

  private async one(viewerId: string, commentId: string): Promise<CommentRow> {
    const rows = await this.db.query<CommentRow>(
      `SELECT c.id, c.post_id, c.author_id, c.parent_id, c.body, c.created_at,
              u.username, u.display_name, rp.avatar_media_id,
              (SELECT count(*) FROM comment_reactions cr WHERE cr.comment_id = c.id)::int AS reaction_count,
              (SELECT cr.kind FROM comment_reactions cr WHERE cr.comment_id = c.id AND cr.user_id = $1) AS viewer_reaction
       FROM comments c
       JOIN users u ON u.id = c.author_id
       LEFT JOIN rider_profiles rp ON rp.user_id = c.author_id
       WHERE c.id = $2 AND c.deleted_at IS NULL`,
      [viewerId, commentId],
    );
    if (!rows[0]) throw new NotFoundException({ code: 'COMMENT_NOT_FOUND', title: 'Komentar tidak ditemukan', detail: 'Komentar tidak tersedia.' });
    return rows[0];
  }

  async remove(userId: string, commentId: string) {
    const rows = await this.db.query<{ id: string; author_id: string; post_id: string; community_id: string | null; post_author_id: string }>(
      `SELECT c.id, c.author_id, c.post_id, p.community_id, p.author_id AS post_author_id
       FROM comments c JOIN posts p ON p.id = c.post_id WHERE c.id = $1 AND c.deleted_at IS NULL`,
      [commentId],
    );
    const comment = rows[0];
    if (!comment) throw new NotFoundException({ code: 'COMMENT_NOT_FOUND', title: 'Komentar tidak ditemukan', detail: 'Komentar tidak tersedia.' });
    let allowed = comment.author_id === userId || comment.post_author_id === userId;
    if (!allowed && comment.community_id) {
      const permission = await communityPermission(this.db, comment.community_id, userId, 'comment.remove_any');
      allowed = permission.allowed;
    }
    if (!allowed) throw new NotFoundException({ code: 'COMMENT_NOT_FOUND', title: 'Komentar tidak ditemukan', detail: 'Komentar tidak tersedia.' });
    await this.db.query(`UPDATE comments SET deleted_at = now() WHERE id = $1`, [commentId]);
    return { id: commentId, deleted: true };
  }

  async react(userId: string, commentId: string, dto: CommentReactionDto) {
    const comment = await this.one(userId, commentId);
    await this.posts.assertVisible(userId, comment.post_id);
    const existing = await this.db.query<{ kind: string }>(
      `SELECT kind FROM comment_reactions WHERE comment_id = $1 AND user_id = $2`,
      [commentId, userId],
    );
    if (existing[0]) {
      if (existing[0].kind === dto.kind) return { commentId, kind: dto.kind, duplicate: true, active: true };
      await this.db.query(`UPDATE comment_reactions SET kind = $3 WHERE comment_id = $1 AND user_id = $2`, [commentId, userId, dto.kind]);
      return { commentId, kind: dto.kind, duplicate: false, active: true };
    }
    await this.db.query(
      `INSERT INTO comment_reactions (comment_id, user_id, kind, client_id) VALUES ($1, $2, $3, $4)`,
      [commentId, userId, dto.kind, dto.clientId],
    );
    return { commentId, kind: dto.kind, duplicate: false, active: true };
  }

  async unreact(userId: string, commentId: string) {
    await this.db.query(`DELETE FROM comment_reactions WHERE comment_id = $1 AND user_id = $2`, [commentId, userId]);
    return { commentId, active: false };
  }
}
