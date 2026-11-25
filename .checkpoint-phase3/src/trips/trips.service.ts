import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE, type Database } from '../db/database.js';
import { isUniqueViolation } from '../common/db-errors.js';
import type { TripPointDto, TripPointsDto } from './trips.dto.js';

type TripRow = {
  id: string;
  user_id: string;
  vehicle_id: string | null;
  route_id: string | null;
  status: string;
  started_at: Date;
  ended_at: Date | null;
  paused_at: Date | null;
  paused_seconds: number;
  distance_m: number;
  duration_s: number;
  avg_speed_kph: string | number | null;
  point_count: number;
  data_quality: Record<string, number>;
  created_at: Date;
};

type StoredPoint = {
  seq: number;
  lat: number;
  lng: number;
  accuracy_m: number;
  recorded_at: Date;
  quality: string;
};

const EARTH_RADIUS_M = 6_371_000;

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

function summary(row: TripRow) {
  return {
    id: row.id,
    vehicleId: row.vehicle_id,
    routeId: row.route_id,
    status: row.status,
    startedAt: new Date(row.started_at).toISOString(),
    endedAt: row.ended_at ? new Date(row.ended_at).toISOString() : null,
    durationS: row.duration_s,
    distanceM: row.distance_m,
    avgSpeedKph: row.avg_speed_kph === null ? null : Number(row.avg_speed_kph),
    pointCount: row.point_count,
    dataQuality: row.data_quality,
    createdAt: new Date(row.created_at).toISOString(),
  };
}

function encodeCursor(startedAt: Date): string {
  return Buffer.from(JSON.stringify({ startedAt: startedAt.toISOString() }), 'utf8').toString('base64url');
}

function decodeCursor(cursor: string): Date {
  try {
    const parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')) as { startedAt?: string };
    const date = new Date(parsed.startedAt ?? '');
    if (Number.isNaN(date.getTime())) throw new Error('invalid');
    return date;
  } catch {
    throw new BadRequestException({ code: 'INVALID_CURSOR', title: 'Cursor tidak valid', detail: 'Cursor pagination tidak valid.' });
  }
}

@Injectable()
export class TripsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private async trip(userId: string, id: string): Promise<TripRow> {
    const rows = await this.db.query<TripRow>('SELECT * FROM trips WHERE id = $1 AND user_id = $2', [id, userId]);
    if (!rows[0]) {
      throw new NotFoundException({ code: 'NOT_FOUND', title: 'Perjalanan tidak ditemukan', detail: 'Perjalanan tidak ada.' });
    }
    return rows[0];
  }

  async active(userId: string) {
    const rows = await this.db.query<TripRow>(
      `SELECT * FROM trips WHERE user_id = $1 AND status IN ('active', 'paused') LIMIT 1`,
      [userId],
    );
    return { trip: rows[0] ? summary(rows[0]) : null };
  }

  async start(userId: string, vehicleId?: string, routeId?: string) {
    if (vehicleId) {
      const vehicle = await this.db.query<{ id: string }>(
        'SELECT id FROM vehicles WHERE id = $1 AND owner_id = $2 AND deleted_at IS NULL',
        [vehicleId, userId],
      );
      if (!vehicle[0]) {
        throw new NotFoundException({ code: 'NOT_FOUND', title: 'Kendaraan tidak ditemukan', detail: 'Kendaraan tidak tersedia untuk pengguna ini.' });
      }
    }
    if (routeId) {
      const route = await this.db.query<{ id: string }>('SELECT id FROM routes WHERE id = $1 AND owner_id = $2', [routeId, userId]);
      if (!route[0]) {
        throw new NotFoundException({ code: 'NOT_FOUND', title: 'Rute tidak ditemukan', detail: 'Rute tidak tersedia untuk pengguna ini.' });
      }
    }

    const id = uuidv7();
    try {
      await this.db.query(
        `INSERT INTO trips (id, user_id, vehicle_id, route_id, status) VALUES ($1, $2, $3, $4, 'active')`,
        [id, userId, vehicleId ?? null, routeId ?? null],
      );
    } catch (error) {
      if (isUniqueViolation(error)) {
        const open = await this.db.query<{ id: string }>(
          `SELECT id FROM trips WHERE user_id = $1 AND status IN ('active', 'paused') LIMIT 1`,
          [userId],
        );
        throw new ConflictException({
          code: 'ACTIVE_TRIP_EXISTS',
          title: 'Sesi aktif sudah ada',
          detail: 'Selesaikan sesi berjalan sebelum memulai sesi baru.',
          activeTripId: open[0]?.id ?? null,
        });
      }
      throw error;
    }
    return summary(await this.trip(userId, id));
  }

  async pause(userId: string, id: string) {
    const trip = await this.trip(userId, id);
    if (trip.status !== 'active') {
      throw new ConflictException({ code: 'INVALID_TRIP_STATE', title: 'Status tidak valid', detail: 'Hanya sesi aktif yang dapat dijeda.' });
    }
    await this.db.query(`UPDATE trips SET status = 'paused', paused_at = now(), updated_at = now() WHERE id = $1`, [id]);
    return summary(await this.trip(userId, id));
  }

  async resume(userId: string, id: string) {
    const trip = await this.trip(userId, id);
    if (trip.status !== 'paused' || !trip.paused_at) {
      throw new ConflictException({ code: 'INVALID_TRIP_STATE', title: 'Status tidak valid', detail: 'Hanya sesi yang dijeda yang dapat dilanjutkan.' });
    }
    const paused = Math.max(0, Math.floor((Date.now() - new Date(trip.paused_at).getTime()) / 1000));
    await this.db.query(
      `UPDATE trips SET status = 'active', paused_seconds = paused_seconds + $2, paused_at = NULL, updated_at = now() WHERE id = $1`,
      [id, paused],
    );
    return summary(await this.trip(userId, id));
  }

  async addPoints(userId: string, id: string, dto: TripPointsDto) {
    const trip = await this.trip(userId, id);
    if (trip.status !== 'active') {
      throw new ConflictException({ code: 'INVALID_TRIP_STATE', title: 'Status tidak valid', detail: 'Titik hanya dapat ditambahkan pada sesi aktif.' });
    }
    if (dto.points.length === 0) return { accepted: 0, duplicates: 0, rejected: [] };

    const previousRows = await this.db.query<StoredPoint>(
      `SELECT seq, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
              accuracy_m, recorded_at, quality
       FROM trip_points WHERE trip_id = $1 AND quality = 'ok' ORDER BY seq DESC LIMIT 1`,
      [id],
    );
    let lastGood: StoredPoint | undefined = previousRows[0];
    const rejected: Array<{ seq: number; code: string }> = [];
    const seen = new Set<number>();
    let accepted = 0;
    let duplicates = 0;

    for (const point of dto.points) {
      if (seen.has(point.seq)) {
        rejected.push({ seq: point.seq, code: 'DUPLICATE_IN_BATCH' });
        continue;
      }
      seen.add(point.seq);
      const recordedAt = new Date(point.recordedAt);
      if (Number.isNaN(recordedAt.getTime()) || recordedAt.getTime() > Date.now() + 5 * 60_000) {
        rejected.push({ seq: point.seq, code: 'INVALID_TIMESTAMP' });
        continue;
      }

      let quality: 'ok' | 'low_accuracy' | 'spike' | 'gap' = 'ok';
      if (point.accuracyM > 100) quality = 'low_accuracy';
      if (lastGood && quality === 'ok') {
        const dt = (recordedAt.getTime() - new Date(lastGood.recorded_at).getTime()) / 1000;
        if (dt > 60) {
          quality = 'gap';
        } else if (dt > 0) {
          const impliedSpeed = haversine(lastGood, point) / dt;
          if (impliedSpeed > 55.6) quality = 'spike';
        }
      }

      const result = await this.db.query<{ seq: number }>(
        `INSERT INTO trip_points (trip_id, seq, location, accuracy_m, speed_mps, heading_deg, recorded_at, quality)
         VALUES ($1, $2, ST_SetSRID(ST_MakePoint($3, $4), 4326)::geography, $5, $6, $7, $8, $9)
         ON CONFLICT (trip_id, seq) DO NOTHING RETURNING seq`,
        [
          id, point.seq, point.lng, point.lat, point.accuracyM,
          point.speedMps ?? null, point.headingDeg ?? null, recordedAt, quality,
        ],
      );
      if (result.length === 0) {
        duplicates += 1;
        continue;
      }
      accepted += 1;
      if (quality === 'ok') lastGood = { seq: point.seq, lat: point.lat, lng: point.lng, accuracy_m: point.accuracyM, recorded_at: recordedAt, quality };
    }

    await this.recalculate(id);
    return { accepted, duplicates, rejected };
  }

  private async recalculate(id: string): Promise<void> {
    const rows = await this.db.query<StoredPoint>(
      `SELECT seq, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
              accuracy_m, recorded_at, quality
       FROM trip_points WHERE trip_id = $1 ORDER BY seq ASC`,
      [id],
    );
    let distance = 0;
    let gaps = 0;
    let spikes = 0;
    let lowAccuracy = 0;
    let previous: StoredPoint | undefined;
    for (const point of rows) {
      if (point.quality === 'gap') gaps += 1;
      if (point.quality === 'spike') spikes += 1;
      if (point.quality === 'low_accuracy') lowAccuracy += 1;
      if (previous && point.quality === 'ok' && previous.quality === 'ok' && point.accuracy_m <= 100) {
        distance += haversine(previous, point);
      }
      if (point.quality !== 'spike' && point.quality !== 'low_accuracy') previous = point;
    }
    const tripRows = await this.db.query<TripRow>('SELECT * FROM trips WHERE id = $1', [id]);
    const trip = tripRows[0];
    if (!trip) return;
    const now = trip.status === 'finished' && trip.ended_at ? new Date(trip.ended_at) : new Date();
    let paused = trip.paused_seconds;
    if (trip.status === 'paused' && trip.paused_at) paused += Math.floor((Date.now() - new Date(trip.paused_at).getTime()) / 1000);
    const duration = Math.max(0, Math.floor((now.getTime() - new Date(trip.started_at).getTime()) / 1000) - paused);
    const distanceM = Math.round(distance);
    const avg = duration > 0 ? Math.round((distanceM / 1000 / (duration / 3600)) * 10) / 10 : null;
    await this.db.query(
      `UPDATE trips SET distance_m = $2, duration_s = $3, avg_speed_kph = $4,
        point_count = $5, data_quality = $6::jsonb, updated_at = now()
       WHERE id = $1`,
      [id, distanceM, duration, avg, rows.length, JSON.stringify({ gaps, spikes, lowAccuracy, rejected: 0 })],
    );
  }

  async finish(userId: string, id: string) {
    const trip = await this.trip(userId, id);
    if (!['active', 'paused'].includes(trip.status)) {
      throw new ConflictException({ code: 'INVALID_TRIP_STATE', title: 'Status tidak valid', detail: 'Sesi sudah selesai.' });
    }
    let paused = trip.paused_seconds;
    if (trip.status === 'paused' && trip.paused_at) {
      paused += Math.max(0, Math.floor((Date.now() - new Date(trip.paused_at).getTime()) / 1000));
    }
    await this.db.query(
      `UPDATE trips SET status = 'finished', ended_at = now(), paused_at = NULL,
         paused_seconds = $2, updated_at = now() WHERE id = $1`,
      [id, paused],
    );
    await this.recalculate(id);
    return summary(await this.trip(userId, id));
  }

  async list(userId: string, limit = 20, cursor?: string) {
    const before = cursor ? decodeCursor(cursor) : null;
    const rows = await this.db.query<TripRow>(
      `SELECT * FROM trips WHERE user_id = $1 ${before ? 'AND started_at < $3' : ''}
       ORDER BY started_at DESC LIMIT $2`,
      before ? [userId, limit + 1, before] : [userId, limit + 1],
    );
    const page = rows.slice(0, limit);
    return {
      items: page.map(summary),
      nextCursor: rows.length > limit ? encodeCursor(new Date(page[page.length - 1].started_at)) : null,
    };
  }

  async get(userId: string, id: string) {
    return summary(await this.trip(userId, id));
  }

  async points(userId: string, id: string, limit = 200, cursor?: number) {
    await this.trip(userId, id);
    const rows = await this.db.query<StoredPoint & { speed_mps: number | null; heading_deg: number | null }>(
      `SELECT seq, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
              accuracy_m, speed_mps, heading_deg, recorded_at, quality
       FROM trip_points
       WHERE trip_id = $1 ${cursor !== undefined ? 'AND seq > $3' : ''}
       ORDER BY seq ASC LIMIT $2`,
      cursor !== undefined ? [id, limit, cursor] : [id, limit],
    );
    return {
      items: rows.map((r) => ({
        seq: r.seq,
        lat: r.lat,
        lng: r.lng,
        accuracyM: r.accuracy_m,
        speedMps: r.speed_mps,
        headingDeg: r.heading_deg,
        recordedAt: new Date(r.recorded_at).toISOString(),
        quality: r.quality,
      })),
      nextCursor: rows.length === limit ? rows[rows.length - 1].seq : null,
    };
  }
}
