import { BadRequestException, Inject, Injectable, Logger, ServiceUnavailableException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { decryptValue, encryptValue, sha256 } from '../common/crypto.js';
import { DATABASE, type Database } from '../db/database.js';
import type { RegisterPushDeviceDto, UpdateNotificationPreferencesDto } from './notifications.dto.js';

export type NotificationKind =
  | 'follow' | 'follow_request' | 'follow_accepted'
  | 'like' | 'comment' | 'mention' | 'save' | 'hazard_nearby';

export type NewNotification = {
  userId: string;
  kind: NotificationKind;
  threadKey: string;
  sourceUserId?: string | null;
  postId?: string | null;
  commentId?: string | null;
  payload?: Record<string, unknown>;
};

type NotificationRow = {
  id: string;
  kind: string;
  thread_key: string;
  source_user_id: string | null;
  post_id: string | null;
  comment_id: string | null;
  payload: Record<string, unknown>;
  unread: boolean;
  created_at: Date;
  read_at: Date | null;
};

type DeviceRow = {
  id: string;
  token_hash: string;
  token_encrypted: string | null;
  platform: string;
  last_seen_at: Date;
};

const PREFERENCE_BY_KIND: Record<NotificationKind, keyof UpdateNotificationPreferencesDto> = {
  follow: 'follow',
  follow_request: 'follow',
  follow_accepted: 'follow',
  like: 'comment',
  comment: 'comment',
  mention: 'mention',
  save: 'comment',
  hazard_nearby: 'hazard',
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
export class NotificationsService {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  /** Returns null when the recipient turned this class of notification off. */
  async create(input: NewNotification): Promise<NotificationRow | null> {
    if (input.sourceUserId === input.userId) return null;
    const prefs = await this.preferences(input.userId);
    const preference = PREFERENCE_BY_KIND[input.kind];
    if (prefs[preference] === false) return null;

    const rows = await this.db.query<NotificationRow>(
      `INSERT INTO notifications (id, user_id, kind, thread_key, source_user_id, post_id, comment_id, payload)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb)
       ON CONFLICT (user_id, thread_key) DO UPDATE
         SET unread = true, updated_at = now(), read_at = NULL,
             payload = EXCLUDED.payload, source_user_id = EXCLUDED.source_user_id
       RETURNING id, kind, thread_key, source_user_id, post_id, comment_id, payload, unread, created_at, read_at`,
      [uuidv7(), input.userId, input.kind, input.threadKey, input.sourceUserId ?? null, input.postId ?? null, input.commentId ?? null, JSON.stringify(input.payload ?? {})],
    );
    const notification = rows[0];
    if (notification) {
      void this.deliverPush(input.userId, notification).catch((error: unknown) => {
        this.logger.warn(`push delivery failed for ${notification.id}: ${String(error)}`);
      });
    }
    return notification ?? null;
  }

  async list(userId: string, unread: boolean | undefined, limit = 20, cursor?: string) {
    const before = cursor ? decodeCursor(cursor) : null;
    const rows = await this.db.query<NotificationRow>(
      `SELECT id, kind, thread_key, source_user_id, post_id, comment_id, payload, unread, created_at, read_at
       FROM notifications
       WHERE user_id = $1
         AND ($2::boolean IS NULL OR unread = $2::boolean)
         AND ($4::timestamptz IS NULL OR (created_at, id) < ($4::timestamptz, $5::uuid))
       ORDER BY created_at DESC, id DESC
       LIMIT $3`,
      [userId, unread ?? null, limit + 1, before?.createdAt ?? null, before?.id ?? null],
    );
    const page = rows.slice(0, limit);
    const unreadCount = await this.db.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM notifications WHERE user_id = $1 AND unread`,
      [userId],
    );
    return {
      items: page.map((row) => this.present(row)),
      unreadCount: Number(unreadCount[0]?.count ?? 0),
      nextCursor: rows.length > limit ? encodeCursor(new Date(page[page.length - 1].created_at), page[page.length - 1].id) : null,
    };
  }

  private present(row: NotificationRow) {
    return {
      id: row.id,
      kind: row.kind,
      threadKey: row.thread_key,
      sourceUserId: row.source_user_id,
      postId: row.post_id,
      commentId: row.comment_id,
      payload: row.payload,
      unread: row.unread,
      createdAt: new Date(row.created_at).toISOString(),
      readAt: row.read_at ? new Date(row.read_at).toISOString() : null,
    };
  }

  async markRead(userId: string, id: string) {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE notifications SET unread = false, read_at = now(), updated_at = now()
       WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, userId],
    );
    return { id: rows[0]?.id ?? id, unread: false, updated: rows.length > 0 };
  }

  async markAllRead(userId: string) {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE notifications SET unread = false, read_at = now(), updated_at = now()
       WHERE user_id = $1 AND unread RETURNING id`,
      [userId],
    );
    return { updated: rows.length };
  }

  async preferences(userId: string) {
    await this.db.query(`INSERT INTO notification_preferences (user_id) VALUES ($1) ON CONFLICT (user_id) DO NOTHING`, [userId]);
    const rows = await this.db.query<{
      mention: boolean; comment: boolean; follow: boolean; hazard: boolean; quiet_nav: boolean; updated_at: Date;
    }>(`SELECT mention, comment, follow, hazard, quiet_nav, updated_at FROM notification_preferences WHERE user_id = $1`, [userId]);
    const row = rows[0];
    return {
      mention: row?.mention ?? true,
      comment: row?.comment ?? true,
      follow: row?.follow ?? true,
      hazard: row?.hazard ?? true,
      quietNav: row?.quiet_nav ?? true,
      updatedAt: row ? new Date(row.updated_at).toISOString() : null,
    };
  }

  async updatePreferences(userId: string, dto: UpdateNotificationPreferencesDto) {
    await this.preferences(userId);
    await this.db.query(
      `UPDATE notification_preferences SET
         mention = COALESCE($2, mention),
         comment = COALESCE($3, comment),
         follow = COALESCE($4, follow),
         hazard = COALESCE($5, hazard),
         quiet_nav = COALESCE($6, quiet_nav),
         updated_at = now()
       WHERE user_id = $1`,
      [userId, dto.mention ?? null, dto.comment ?? null, dto.follow ?? null, dto.hazard ?? null, dto.quietNav ?? null],
    );
    return this.preferences(userId);
  }

  private sealToken(token: string): string {
    if (!this.config.contactKey) {
      throw new ServiceUnavailableException({
        code: 'PUSH_KEY_MISSING',
        title: 'Penyimpanan token push belum dikonfigurasi',
        detail: 'CONTACT_ENCRYPTION_KEY must be set to register a push device.',
      });
    }
    const sealed = encryptValue(token, this.config.contactKey);
    return JSON.stringify({
      v: sealed.keyVersion,
      iv: sealed.iv.toString('base64url'),
      tag: sealed.tag.toString('base64url'),
      ct: sealed.ciphertext.toString('base64url'),
    });
  }

  private openToken(sealed: string): string | null {
    if (!this.config.contactKey) return null;
    try {
      const parts = JSON.parse(sealed) as { iv: string; tag: string; ct: string };
      return decryptValue(
        {
          iv: Buffer.from(parts.iv, 'base64url'),
          tag: Buffer.from(parts.tag, 'base64url'),
          ciphertext: Buffer.from(parts.ct, 'base64url'),
          keyVersion: 1,
        },
        this.config.contactKey,
      );
    } catch {
      return null;
    }
  }

  async registerDevice(userId: string, dto: RegisterPushDeviceDto) {
    const sealed = this.sealToken(dto.token);
    const hash = sha256(dto.token);
    await this.db.transaction(async (tx) => {
      const existing = await tx.query<{ id: string }>(
        `SELECT id FROM push_devices WHERE user_id = $1 AND client_device_id = $2`,
        [userId, dto.clientDeviceId],
      );
      if (existing[0]) {
        await tx.query(
          `UPDATE push_devices SET token_hash = $2, token_encrypted = $3, platform = $4, last_seen_at = now() WHERE id = $1`,
          [existing[0].id, hash, sealed, dto.platform],
        );
        return;
      }
      const rows = await tx.query<{ id: string }>(
        `INSERT INTO push_devices (id, user_id, token_hash, token_encrypted, platform, client_device_id)
         VALUES ($1, $2, $3, $4, $5, $6)
         ON CONFLICT (token_hash) DO UPDATE SET last_seen_at = now(), token_encrypted = EXCLUDED.token_encrypted
         RETURNING id`,
        [uuidv7(), userId, hash, sealed, dto.platform, dto.clientDeviceId],
      );
      void rows;
    });
    const device = await this.db.query<{ id: string; platform: string; last_seen_at: Date }>(
      `SELECT id, platform, last_seen_at FROM push_devices WHERE user_id = $1 AND client_device_id = $2`,
      [userId, dto.clientDeviceId],
    );
    return {
      id: device[0]?.id ?? null,
      platform: device[0]?.platform ?? dto.platform,
      pushConfigured: Boolean(this.config.fcmServerKey),
      registered: true,
    };
  }

  async removeDevice(userId: string, id: string) {
    const rows = await this.db.query<{ id: string }>(
      `DELETE FROM push_devices WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, userId],
    );
    return { removed: rows.length > 0 };
  }

  /**
   * Best-effort FCM delivery. Without FCM_SERVER_KEY this reports "not
   * configured" and the in-app row remains the source of truth, so a missing
   * push credential never blocks a social action.
   */
  private async deliverPush(userId: string, notification: NotificationRow) {
    if (!this.config.fcmServerKey) return;
    const devices = await this.db.query<DeviceRow>(
      `SELECT id, token_hash, token_encrypted, platform, last_seen_at FROM push_devices WHERE user_id = $1`,
      [userId],
    );
    for (const device of devices) {
      if (!device.token_encrypted) continue;
      const token = this.openToken(device.token_encrypted);
      if (!token) continue;
      const response = await fetch('https://fcm.googleapis.com/fcm/send', {
        method: 'POST',
        headers: { Authorization: `key=${this.config.fcmServerKey}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({
          to: token,
          notification: { title: 'RiderJourney', body: String(notification.payload.message ?? notification.kind) },
          data: { kind: notification.kind, threadKey: notification.thread_key },
        }),
        signal: AbortSignal.timeout(5_000),
      });
      if (response.ok) {
        await this.db.query(`UPDATE notifications SET pushed_at = now() WHERE id = $1`, [notification.id]);
      }
    }
  }
}
