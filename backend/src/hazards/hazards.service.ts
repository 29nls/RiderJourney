import { HttpException, HttpStatus, Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.js';
import { RealtimeHub } from '../realtime/realtime.hub.js';
import { REALTIME_STORE, type RealtimeStore } from '../realtime/realtime.store.js';
import type { ConfirmHazardDto, CreateHazardDto, NearbyQueryDto, ReportHazardDto } from './hazards.dto.js';
import { ACTIVE_HAZARD_FILTER, type HazardRow } from './hazards.types.js';

type HazardView = HazardRow & { display_name: string; username: string; distance_m?: number | null };

const HAZARD_COLUMNS = `
  h.id, h.reporter_id, h.kind::text, h.location::geography AS location, ST_Y(h.location::geometry)::float8 AS lat,
  ST_X(h.location::geometry)::float8 AS lng, h.note, h.photo_media_id,
  h.status::text, h.moderation_status::text, h.expires_at, h.created_at, h.updated_at,
  h.still_present_count, h.not_relevant_count, h.last_confirmed_at, h.duplicate_of_id,
  u.display_name, u.username`;

const VIEW_SELECT = `
  SELECT ${HAZARD_COLUMNS}
  FROM hazard_reports h JOIN users u ON u.id = h.reporter_id`;

const nearPoint = 'ST_SetSRID(ST_MakePoint($1, $2), 4326)::geography';

/** Re-derived on read: time passes between the write and the response. */
function isLive(row: Pick<HazardRow, 'status' | 'moderation_status' | 'expires_at'>) {
  return row.status === 'active' && row.moderation_status === 'visible' && new Date(row.expires_at).getTime() > Date.now();
}

function serialize(row: HazardView) {
  const active = isLive(row);
  return {
    id: row.id,
    reporter: { id: row.reporter_id, displayName: row.display_name, username: row.username },
    kind: row.kind,
    location: { lat: row.lat, lng: row.lng },
    note: row.note,
    photoMediaId: row.photo_media_id,
    status: row.status,
    active,
    stale: !active,
    moderationStatus: row.moderation_status,
    createdAt: new Date(row.created_at).toISOString(),
    expiresAt: new Date(row.expires_at).toISOString(),
    lastConfirmedAt: row.last_confirmed_at ? new Date(row.last_confirmed_at).toISOString() : null,
    stillPresentCount: row.still_present_count,
    notRelevantCount: row.not_relevant_count,
    distanceM: row.distance_m === undefined ? null : row.distance_m,
    duplicateOfId: row.duplicate_of_id,
  };
}

function hazardGone(): never {
  throw new NotFoundException({ code: 'HAZARD_NOT_FOUND', title: 'Bahaya tidak ditemukan', detail: 'Laporan ini tidak tersedia atau sudah kedaluwarsa.' });
}

@Injectable()
export class HazardsService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REALTIME_STORE) private readonly store: RealtimeStore,
    private readonly hub: RealtimeHub,
  ) {}

  /** Retire lapsed hazards before any read so old danger cannot answer as active. */
  private async sweep(): Promise<void> {
    await this.db.query(
      `UPDATE hazard_reports SET status = 'expired', updated_at = now()
       WHERE status = 'active' AND expires_at <= now()`,
    );
  }

  private ttlFor(requested: number | undefined): number {
    const max = this.config.hazardTtlSeconds;
    if (requested === undefined) return max;
    if (requested > max) {
      throw new UnprocessableEntityException({
        code: 'HAZARD_TTL_INVALID',
        title: 'Masa berlaku bahaya tidak valid',
        detail: `Masa berlaku laporan paling lama ${max} detik mengikuti kebijakan keselamatan.`,
      });
    }
    return requested;
  }

  async nearby(query: NearbyQueryDto) {
    await this.sweep();
    const radius = Math.min(query.radiusM ?? 3000, 10_000);
    const since = query.since === '7d' ? '7 days' : '24 hours';
    const rows = await this.db.query<HazardView>(
      `SELECT ${HAZARD_COLUMNS},
         ST_Distance(h.location, ${nearPoint})::float8 AS distance_m
       FROM hazard_reports h JOIN users u ON u.id = h.reporter_id
       WHERE ${ACTIVE_HAZARD_FILTER}
         AND h.created_at >= now() - $3::interval
         AND ST_DWithin(h.location, ${nearPoint}, $4::int)
       ORDER BY ST_Distance(h.location, ${nearPoint}) ASC, h.created_at DESC
       LIMIT 100`,
      [query.lng, query.lat, since, radius],
    );
    return {
      items: rows.map((row) => {
        const view = serialize(row);
        return { ...view, distanceM: Math.round(row.distance_m ?? 0) };
      }),
      radiusM: radius,
      serverTime: new Date().toISOString(),
    };
  }

  async create(userId: string, dto: CreateHazardDto) {
    await this.sweep();
    const ttl = this.ttlFor(dto.ttlSeconds);
    this.assertTime(dto.observedAt);

    const created = await this.store.incrementRateLimit(`hazard:create:${userId}`, 3600);
    if (created > this.config.hazardRateLimitPerHour) {
      throw new HttpException(
        {
          code: 'HAZARD_RATE_LIMITED',
          title: 'Terlalu banyak laporan bahaya',
          detail: `Batas ${this.config.hazardRateLimitPerHour} laporan per jam tercapai. Laporkan yang benar-benar Anda temui.`,
          retryAfterSeconds: 3600,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    // Somebody else's fresh report of the same kind this close is the same road
    // condition, not new information: boost it instead of flooding the map.
    const nearby = await this.db.query<{ id: string; reporter_id: string }>(
      `SELECT id, reporter_id FROM hazard_reports
       WHERE status = 'active' AND moderation_status = 'visible' AND kind = $1
         AND created_at >= now() - interval '30 minutes'
         AND ST_DWithin(location, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography, $4)
       ORDER BY ST_Distance(location, ST_SetSRID(ST_MakePoint($3, $2), 4326)::geography) ASC
       LIMIT 1`,
      [dto.kind, dto.location.lat, dto.location.lng, this.config.hazardDuplicateRadiusM],
    );

    if (nearby[0]?.reporter_id === userId) {
      throw new HttpException(
        {
          code: 'HAZARD_DUPLICATE_SELF',
          title: 'Laporan serupa sudah ada',
          detail: 'Anda sudah melaporkan bahaya jenis ini di titik yang sama dalam 30 menit terakhir.',
        },
        HttpStatus.CONFLICT,
      );
    }

    if (dto.sameAsNearby && !nearby[0]) {
      throw new UnprocessableEntityException({
        code: 'HAZARD_MERGE_TARGET_MISSING',
        title: 'Bahaya tidak ditemukan',
        detail: 'Tidak ada laporan serupa di sekitar titik ini untuk dikonfirmasi.',
      });
    }

    if (nearby[0] && dto.sameAsNearby) {
      return this.confirm(userId, nearby[0].id, { verdict: 'still_present' });
    }

    return this.insert(userId, dto, ttl, null);
  }

  private assertTime(observedAt: string) {
    const at = new Date(observedAt).getTime();
    if (!Number.isFinite(at) || at > Date.now() + 60_000) {
      throw new UnprocessableEntityException({ code: 'HAZARD_TIME_INVALID', title: 'Waktu laporan tidak valid', detail: 'Waktu observasi tidak boleh di masa depan.' });
    }
  }

  private async insert(userId: string, dto: CreateHazardDto, ttl: number, duplicateOf: string | null) {
    const id = uuidv7();
    let photoId: string | null = null;
    if (dto.photoMediaId) {
      const media = await this.db.query<{ id: string }>(
        `SELECT id FROM media_assets WHERE id = $1 AND owner_id = $2 AND purpose = 'hazard_photo' AND status = 'ready'`,
        [dto.photoMediaId, userId],
      );
      if (!media[0]) {
        throw new UnprocessableEntityException({ code: 'MEDIA_NOT_OWNED', title: 'Foto tidak valid', detail: 'Foto harus diunggah melalui alur unggah resmi dan sudah selesai.' });
      }
      photoId = dto.photoMediaId;
    }
    const expiresAt = new Date(new Date(dto.observedAt).getTime() + ttl * 1000);
    await this.db.query(
      `INSERT INTO hazard_reports (id, reporter_id, kind, location, note, photo_media_id, expires_at, duplicate_of_id)
       VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography, $6, $7, $8, $9)`,
      [id, userId, dto.kind, dto.location.lat, dto.location.lng, dto.note?.trim() || null, photoId, expiresAt, duplicateOf],
    );
    // The viewer is the reporter, so the distance back to them is zero.
    const row = (
      await this.db.query<HazardView>(`${VIEW_SELECT} WHERE h.id = $1`, [id])
    )[0];
    await this.hub.publish('hazard:global', 'hazard.created', { hazard: serialize(row) });
    return serialize(row);
  }

  /**
   * Two distinct "not relevant" votes outnumbering "still present" retire a
   * report. One rider alone cannot clear a hazard someone else reported.
   */
  private async recompute(hazardId: string) {
    const rows = await this.db.query<{ still_present_count: number; not_relevant_count: number }>(
      `SELECT still_present_count, not_relevant_count FROM hazard_reports WHERE id = $1`,
      [hazardId],
    );
    const row = rows[0];
    if (!row) return;
    const removed = row.not_relevant_count >= 2 && row.not_relevant_count > row.still_present_count;
    await this.db.query(
      `UPDATE hazard_reports SET status = CASE WHEN status = 'active' AND $2::boolean THEN 'removed' ELSE status END,
         updated_at = now() WHERE id = $1`,
      [hazardId, removed],
    );
  }

  async confirm(userId: string, hazardId: string, dto: ConfirmHazardDto) {
    const rows = await this.db.query<{ reporter_id: string; expires_at: Date }>(
      `SELECT reporter_id, expires_at FROM hazard_reports
       WHERE id = $1 AND status = 'active' AND moderation_status = 'visible'`,
      [hazardId],
    );
    const hazard = rows[0];
    if (!hazard) hazardGone();
    if (new Date(hazard.expires_at).getTime() <= Date.now()) {
      await this.sweep();
      hazardGone();
    }

    const rate = await this.store.incrementRateLimit(`hazard:confirm:${userId}`, 3600);
    if (rate > 60) {
      throw new HttpException(
        { code: 'HAZARD_CONFIRM_RATE_LIMITED', title: 'Terlalu banyak konfirmasi', detail: 'Tunggu sebelum mengonfirmasi laporan lagi.' },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    await this.db.query(
      `INSERT INTO hazard_confirmations (hazard_id, user_id, verdict)
       VALUES ($1, $2, $3) ON CONFLICT (hazard_id, user_id) DO UPDATE SET verdict = EXCLUDED.verdict, updated_at = now()`,
      [hazardId, userId, dto.verdict],
    );
    await this.recompute(hazardId);
    const view = (
      await this.db.query<HazardView>(`${VIEW_SELECT} WHERE h.id = $6`, [null, null, null, null, null, hazardId])
    )[0];
    return { hazard: serialize(view), verdict: dto.verdict };
  }

  async report(userId: string, hazardId: string, dto: ReportHazardDto) {
    await this.db.query(
      `INSERT INTO content_reports (id, reporter_id, target_type, target_id, reason, note)
       VALUES ($1, $2, 'hazard', $3, $4, $5)
       ON CONFLICT (reporter_id, target_type, target_id) DO NOTHING`,
      [uuidv7(), userId, hazardId, dto.reason, dto.note?.trim() ?? null],
    );
    // Three independent riders reporting the same hazard enough to hide it: a
    // three-click rule, not per-report moderation, so a grudge cannot bury a warning.
    const reports = await this.db.query<{ count: number }>(
      `SELECT count(*)::int AS count FROM content_reports
       WHERE target_type = 'hazard' AND target_id = $1 AND status = 'pending'`,
      [hazardId],
    );
    if (reports[0].count >= 3) {
      await this.db.query(
        `UPDATE hazard_reports SET moderation_status = 'hidden', status = 'removed', updated_at = now() WHERE id = $1`,
        [hazardId],
      );
    }
    return { reported: true };
  }
}