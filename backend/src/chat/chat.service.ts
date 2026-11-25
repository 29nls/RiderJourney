import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.js';
import { requireLiveConvoyMember } from '../convoys/convoy-access.js';
import { RealtimeHub } from '../realtime/realtime.hub.js';
import { REALTIME_STORE, type RealtimeStore } from '../realtime/realtime.store.js';
import type { MessagePageQueryDto, ReportMessageDto, SendMessageDto } from './chat.dto.js';

type MessageRow = {
  id: string;
  convoy_id: string;
  sender_id: string;
  client_message_id: string;
  kind: 'text' | 'location' | 'waypoint';
  body: string | null;
  lat: number | null;
  lng: number | null;
  label: string | null;
  moderation_status: 'visible' | 'hidden' | 'removed';
  created_at: Date;
  display_name: string;
  username: string;
};

const MESSAGE_SELECT = `
  SELECT m.id, m.convoy_id, m.sender_id, m.client_message_id, m.kind, m.body, m.label,
    m.moderation_status, m.created_at, u.display_name, u.username,
    ST_Y(m.location::geometry)::float8 AS lat,
    ST_X(m.location::geometry)::float8 AS lng
  FROM convoy_messages m
  JOIN users u ON u.id = m.sender_id`;

function encodeCursor(row: MessageRow): string {
  return Buffer.from(JSON.stringify({ createdAt: new Date(row.created_at).toISOString(), id: row.id })).toString('base64url');
}

function decodeCursor(raw: string | undefined): { createdAt: string; id: string } | null {
  if (!raw) return null;
  try {
    const value = JSON.parse(Buffer.from(raw, 'base64url').toString('utf8')) as { createdAt?: unknown; id?: unknown };
    const createdAt = typeof value.createdAt === 'string' ? value.createdAt : '';
    if (!createdAt || !Number.isFinite(new Date(createdAt).getTime()) || typeof value.id !== 'string') {
      throw new Error('invalid cursor');
    }
    return { createdAt, id: value.id };
  } catch {
    throw new UnprocessableEntityException({
      code: 'INVALID_CURSOR',
      title: 'Cursor tidak valid',
      detail: 'Muat ulang pesan dari awal.',
    });
  }
}

/**
 * Delivery state must stay honest while the vehicle is moving: a message is only
 * "delivered" when every other active member holds a live realtime connection.
 * Otherwise it is "sent" and shows as unread until they open history.
 */
function deliveryOf(row: MessageRow, otherOnline: number, otherTotal: number) {
  if (row.moderation_status !== 'visible') return 'hidden';
  return otherTotal > 0 && otherOnline >= otherTotal ? 'delivered' : 'sent';
}

function serialize(row: MessageRow, totals: { otherOnline: number; otherTotal: number }) {
  return {
    id: row.id,
    convoyId: row.convoy_id,
    clientMessageId: row.client_message_id,
    sender: { id: row.sender_id, displayName: row.display_name, username: row.username },
    kind: row.kind,
    body: row.body,
    location: row.lat === null || row.lng === null ? null : { lat: row.lat, lng: row.lng },
    label: row.label,
    deliveryState: deliveryOf(row, totals.otherOnline, totals.otherTotal),
    createdAt: new Date(row.created_at).toISOString(),
  };
}

@Injectable()
export class ChatService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REALTIME_STORE) private readonly store: RealtimeStore,
    private readonly hub: RealtimeHub,
  ) {}

  private async access(convoyId: string, userId: string) {
    return requireLiveConvoyMember(this.db, convoyId, userId, 'Akses chat ditolak');
  }

  /** Active members other than the viewer, plus how many of them hold a live socket. */
  private async recipients(convoyId: string, viewerId: string) {
    const rows = await this.db.query<{ user_id: string }>(
      `SELECT user_id FROM convoy_members WHERE convoy_id = $1 AND status = 'active' AND user_id <> $2`,
      [convoyId, viewerId],
    );
    const online = rows.filter((row) => this.hub.hasConnections(convoyId, row.user_id)).length;
    return { otherOnline: online, otherTotal: rows.length };
  }

  async list(userId: string, convoyId: string, query: MessagePageQueryDto) {
    await this.access(convoyId, userId);
    const limit = query.limit ?? 20;
    const cursor = decodeCursor(query.before);
    const rows = await this.db.query<MessageRow>(
      `${MESSAGE_SELECT}
       WHERE m.convoy_id = $1
         AND m.moderation_status = 'visible'
         AND NOT EXISTS (
           SELECT 1 FROM user_blocks b
           WHERE (b.blocker_id = $2 AND b.blocked_id = m.sender_id)
              OR (b.blocker_id = m.sender_id AND b.blocked_id = $2)
         )
         AND ($3::timestamptz IS NULL OR m.created_at < $3::timestamptz
              OR (m.created_at = $3::timestamptz AND m.id < $4::uuid))
       ORDER BY m.created_at DESC, m.id DESC
       LIMIT $5`,
      [convoyId, userId, cursor?.createdAt ?? null, cursor?.id ?? null, limit + 1],
    );
    const page = rows.slice(0, limit);
    const totals = await this.recipients(convoyId, userId);
    return {
      items: page.map((row) => serialize(row, totals)),
      nextCursor: rows.length > limit && page.length > 0 ? encodeCursor(page[page.length - 1]) : null,
    };
  }

  /**
   * Reject a burst the recipient could not physically have typed. A message
   * that arrives faster than a human types is a spam signal, not conversation.
   */
  private async assertTypingBudget(convoyId: string, userId: string, text: string) {
    const budget = Math.max(2, Math.ceil(text.length / this.config.chatTypingCharsPerSecond));
    const key = 'chat:typing:' + convoyId + ':' + userId;
    const used = await this.store.incrementRateLimit(key, budget);
    if (used <= budget) return;
    throw new HttpException(
      {
        code: 'CHAT_TYPING_PACE',
        title: 'Pesan dikirim terlalu cepat',
        detail: 'Beberapa pesan berturut-turut dalam waktu singkat. Tunggu sebentar sebelum mengirim lagi.',
        retryAfterSeconds: budget,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /**
   * A block is mutual for chat: while it applies to an active member, neither
   * side can send, so no message can route around the block.
   */
  private async assertNoBlock(convoyId: string, userId: string) {
    const rows = await this.db.query<{ user_id: string }>(
      `SELECT m.user_id
       FROM convoy_members m
       JOIN user_blocks b
         ON (b.blocker_id = $1 AND b.blocked_id = m.user_id)
         OR (b.blocker_id = m.user_id AND b.blocked_id = $1)
       WHERE m.convoy_id = $2 AND m.status = 'active' AND m.user_id <> $1
       LIMIT 1`,
      [userId, convoyId],
    );
    if (rows[0]) {
      throw new ForbiddenException({
        code: 'CHAT_BLOCKED',
        title: 'Pesan tidak dapat dikirim',
        detail: 'Ada blokir antara Anda dan anggota konvoi ini, jadi pesan tidak dikirim.',
      });
    }
  }

  async send(userId: string, convoyId: string, dto: SendMessageDto) {
    await this.access(convoyId, userId);
    await this.assertNoBlock(convoyId, userId);
    const body = dto.kind === 'text' ? (dto.body?.trim() ?? '') : null;
    if (dto.kind === 'text' && !body) {
      throw new UnprocessableEntityException({ code: 'EMPTY_MESSAGE', title: 'Pesan kosong', detail: 'Pesan teks wajib berisi 1 sampai 2000 karakter.' });
    }
    if (dto.kind !== 'text') {
      const lat = dto.lat;
      const lng = dto.lng;
      const valid = typeof lat === 'number' && typeof lng === 'number'
        && Math.abs(lat) <= 90 && Math.abs(lng) <= 180 && !(lat === 0 && lng === 0);
      if (!valid) {
        throw new UnprocessableEntityException({ code: 'INVALID_SHARED_LOCATION', title: 'Lokasi tidak valid', detail: 'Pesan lokasi memerlukan koordinat yang valid.' });
      }
    }
    if (dto.kind === 'text') await this.assertTypingBudget(convoyId, userId, body!);

    const inserted = await this.db.query<{ id: string }>(
      `INSERT INTO convoy_messages (id, convoy_id, sender_id, client_message_id, kind, body, location, label)
       VALUES ($1, $2, $3, $4, $5, $6,
         CASE WHEN $7::float8 IS NULL THEN NULL
              ELSE ST_SetSRID(ST_MakePoint($8::float8, $7::float8), 4326)::geography END,
         $9)
       ON CONFLICT (convoy_id, sender_id, client_message_id) DO NOTHING
       RETURNING id`,
      [uuidv7(), convoyId, userId, dto.clientMessageId, dto.kind, body, dto.lat ?? null, dto.lng ?? null, dto.label?.trim() ?? null],
    );
    if (!inserted[0]) return this.replay(convoyId, userId, dto.clientMessageId);
    const row = (await this.db.query<MessageRow>(`${MESSAGE_SELECT} WHERE m.id = $1`, [inserted[0].id]))[0];
    const message = { ...serialize(row, await this.recipients(convoyId, userId)), duplicate: false };
    await this.hub.publish(convoyId, 'convoy.chat.message', { message });
    return message;
  }

  /** Same clientMessageId means the first attempt already landed; hand it back untouched. */
  private async replay(convoyId: string, userId: string, clientMessageId: string) {
    const rows = await this.db.query<MessageRow>(
      `${MESSAGE_SELECT} WHERE m.convoy_id = $1 AND m.sender_id = $2 AND m.client_message_id = $3`,
      [convoyId, userId, clientMessageId],
    );
    if (!rows[0]) {
      throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND', title: 'Pesan tidak ditemukan', detail: 'Pesan idempoten tidak dapat dipulihkan.' });
    }
    const totals = await this.recipients(convoyId, userId);
    return { ...serialize(rows[0], totals), duplicate: true };
  }

  async report(userId: string, convoyId: string, messageId: string, dto: ReportMessageDto) {
    await this.access(convoyId, userId);
    const rows = await this.db.query<{ id: string; sender_id: string }>(
      'SELECT id, sender_id FROM convoy_messages WHERE id = $1 AND convoy_id = $2',
      [messageId, convoyId],
    );
    const message = rows[0];
    if (!message) throw new NotFoundException({ code: 'MESSAGE_NOT_FOUND', title: 'Pesan tidak ditemukan', detail: 'Pesan tidak tersedia pada konvoi ini.' });
    if (message.sender_id === userId) {
      throw new UnprocessableEntityException({ code: 'CANNOT_REPORT_SELF', title: 'Laporan tidak valid', detail: 'Pilih pesan dari rider lain.' });
    }
    await this.db.query(
      `INSERT INTO content_reports (id, reporter_id, target_type, target_id, reason, note)
       VALUES ($1, $2, 'message', $3, $4, $5)
       ON CONFLICT (reporter_id, target_type, target_id) DO NOTHING`,
      [uuidv7(), userId, messageId, dto.reason, dto.note?.trim() ?? null],
    );
    return { reported: true };
  }

}
