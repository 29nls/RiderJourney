import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE, type Database } from '../db/database.js';
import type { CreateTripPhotoDto } from './replay.dto.js';

type TripRow = {
  id: string;
  user_id: string;
  status: string;
  started_at: Date;
  ended_at: Date | null;
  distance_m: number;
  duration_s: number;
  avg_speed_kph: string | number | null;
  point_count: number;
  data_quality: Record<string, unknown>;
  shared_with: string[];
};

type PointRow = {
  seq: number;
  lat: number;
  lng: number;
  accuracy_m: number;
  recorded_at: Date;
  quality: string;
};

type PhotoRow = {
  id: string;
  media_id: string;
  position_m: string | number;
  taken_at: Date | null;
  created_at: Date;
  mime_type: string;
  width: number | null;
  height: number | null;
};

const EARTH_RADIUS_M = 6_371_000;
const MAX_PLAUSIBLE_SPEED_MPS = 55.6; // 200 km/h, above any legal road use

function haversine(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const toRad = (d: number) => (d * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
  return 2 * EARTH_RADIUS_M * Math.asin(Math.min(1, Math.sqrt(h)));
}

type Segment = {
  seq: number;
  points: Array<{ lat: number; lng: number }>;
  distanceM: number;
  durationS: number;
  startedAt: string;
  endedAt: string;
  gapBeforeS: number;
  noisyPoints: number;
};

/**
 * Rebuilds replay geometry from recorded points, never from client claims.
 * A hole in reception becomes one gap before the next segment; spikes and
 * low-accuracy fixes are dropped from the line and counted as noise, so a
 * single bad GPS sample cannot bend the route or inflate the distance.
 */
export function buildSegments(points: PointRow[]): {
  segments: Segment[];
  distanceM: number;
  movingDurationS: number;
  gaps: number;
  noisyPoints: number;
  spikeCount: number;
  lowAccuracyCount: number;
} {
  const segments: Segment[] = [];
  let run: PointRow[] = [];
  let gapBeforeS = 0;
  let lastAccepted: PointRow | null = null;
  let spikes = 0;
  let lowAccuracy = 0;
  let gapCount = 0;

  const flush = (noisy: number) => {
    if (run.length < 2) {
      run = [];
      return;
    }
    let distance = 0;
    for (let i = 1; i < run.length; i += 1) distance += haversine(run[i - 1], run[i]);
    const started = run[0].recorded_at.getTime();
    const ended = run[run.length - 1].recorded_at.getTime();
    segments.push({
      seq: segments.length,
      points: run.map((point) => ({ lat: point.lat, lng: point.lng })),
      distanceM: Math.round(distance),
      durationS: Math.max(0, Math.round((ended - started) / 1000)),
      startedAt: new Date(started).toISOString(),
      endedAt: new Date(ended).toISOString(),
      gapBeforeS,
      noisyPoints: noisy,
    });
    gapBeforeS = 0;
    run = [];
  };

  for (const point of points) {
    if (point.quality === 'spike') {
      spikes += 1;
      flush(1);
      continue;
    }
    if (point.quality === 'low_accuracy' || point.accuracy_m > 100) {
      lowAccuracy += 1;
      flush(1);
      continue;
    }
    if (point.quality === 'gap') {
      gapCount += 1;
      const reference = lastAccepted;
      flush(1);
      gapBeforeS = reference ? Math.max(0, Math.round((point.recorded_at.getTime() - reference.recorded_at.getTime()) / 1000)) : 0;
      continue;
    }
    if (lastAccepted) {
      const dt = (point.recorded_at.getTime() - lastAccepted.recorded_at.getTime()) / 1000;
      const samePlace = haversine(lastAccepted, point) < 1;
      if ((dt > 0 && haversine(lastAccepted, point) / dt > MAX_PLAUSIBLE_SPEED_MPS) || (samePlace && dt < 2)) {
        spikes += 1;
        continue;
      }
    }
    run.push(point);
    lastAccepted = point;
  }
  flush(0);

  return {
    segments,
    distanceM: segments.reduce((sum, segment) => sum + segment.distanceM, 0),
    movingDurationS: segments.reduce((sum, segment) => sum + segment.durationS, 0),
    gaps: gapCount,
    noisyPoints: spikes + lowAccuracy,
    spikeCount: spikes,
    lowAccuracyCount: lowAccuracy,
  };
}

function tripAccess(db: Database, viewerId: string, tripId: string) {
  return db.query<TripRow & { username: string; display_name: string }>(
    `SELECT t.*, u.username, u.display_name FROM trips t JOIN users u ON u.id = t.user_id
     WHERE t.id = $1 AND (t.user_id = $2 OR $2::uuid = ANY(t.shared_with))`,
    [tripId, viewerId],
  );
}

function pointAtDistance(
  segments: Segment[],
  positionM: number,
): { lat: number; lng: number } | null {
  let remaining = positionM;
  for (const segment of segments) {
    for (let i = 1; i < segment.points.length; i += 1) {
      const a = segment.points[i - 1];
      const b = segment.points[i];
      const step = haversine(a, b);
      if (remaining <= step) {
        const ratio = step === 0 ? 0 : remaining / step;
        return { lat: a.lat + (b.lat - a.lat) * ratio, lng: a.lng + (b.lng - a.lng) * ratio };
      }
      remaining -= step;
    }
  }
  const last = segments[segments.length - 1];
  return last ? last.points[last.points.length - 1] : null;
}

@Injectable()
export class ReplayService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private async trip(viewerId: string, tripId: string) {
    const rows = await tripAccess(this.db, viewerId, tripId);
    if (!rows[0]) {
      throw new NotFoundException({ code: 'TRIP_NOT_FOUND', title: 'Perjalanan tidak ditemukan', detail: 'Perjalanan tidak tersedia untuk akun ini.' });
    }
    return rows[0];
  }

  async replay(viewerId: string, tripId: string) {
    const trip = await this.trip(viewerId, tripId);
    const points = await this.db.query<PointRow>(
      `SELECT seq, ST_Y(location::geometry) AS lat, ST_X(location::geometry) AS lng,
              accuracy_m, recorded_at, quality
       FROM trip_points WHERE trip_id = $1 ORDER BY seq ASC`,
      [tripId],
    );
    const built = buildSegments(points);

    await this.persist(tripId, built.segments, built);

    const photos = await this.photos(tripId, viewerId);
    const reactions = await this.db.query<{ kind: string; count: number }>(
      `SELECT kind, count(*)::int AS count FROM trip_reactions WHERE trip_id = $1 GROUP BY kind`,
      [tripId],
    );
    const viewerReaction = await this.db.query<{ kind: string }>(
      `SELECT kind FROM trip_reactions WHERE trip_id = $1 AND user_id = $2`,
      [tripId, viewerId],
    );
    const comments = await this.db.query<{
      id: string; author_id: string; body: string; position_m: string | number | null;
      created_at: Date; username: string; display_name: string;
    }>(
      `SELECT c.id, c.author_id, c.body, c.position_m, c.created_at, u.username, u.display_name
       FROM trip_comments c JOIN users u ON u.id = c.author_id
       WHERE c.trip_id = $1 AND c.deleted_at IS NULL
       ORDER BY c.created_at DESC LIMIT 20`,
      [tripId],
    );

    const stats = {
      distanceM: built.distanceM,
      movingDurationS: built.movingDurationS,
      elapsedS: trip.duration_s,
      avgSpeedKph: built.movingDurationS > 0 ? Math.round((built.distanceM / 1000 / (built.movingDurationS / 3600)) * 10) / 10 : null,
      pointCount: points.length,
      acceptedPoints: points.filter((point) => point.quality === 'ok').length,
      gaps: built.gaps,
      noisyPoints: built.noisyPoints,
      spikeCount: built.spikeCount,
      lowAccuracyCount: built.lowAccuracyCount,
      verified: true,
      source: 'server' as const,
    };

    const markers = photos.items.map((photo) => ({
      ...photo,
      ...(pointAtDistance(built.segments, photo.positionM) ?? {}),
    }));

    return {
      trip: {
        id: trip.id,
        ownerId: trip.user_id,
        status: trip.status,
        startedAt: new Date(trip.started_at).toISOString(),
        endedAt: trip.ended_at ? new Date(trip.ended_at).toISOString() : null,
        distanceM: trip.distance_m,
        durationS: trip.duration_s,
      },
      stats,
      playback: {
        durationS: stats.movingDurationS,
        distanceM: stats.distanceM,
        segmentCount: built.segments.length,
        segments: built.segments.map((segment) => ({
          seq: segment.seq,
          geometry: { type: 'LineString' as const, coordinates: segment.points.map((point) => [point.lng, point.lat]) },
          distanceM: segment.distanceM,
          durationS: segment.durationS,
          startedAt: segment.startedAt,
          endedAt: segment.endedAt,
          gapBeforeS: segment.gapBeforeS,
        })),
        timeline: this.timeline(built.segments),
      },
      markers,
      photos: markers,
      reactions: {
        counts: Object.fromEntries(reactions.map((row) => [row.kind, row.count])),
        viewer: viewerReaction[0]?.kind ?? null,
      },
      comments: comments.map((row) => ({
        id: row.id,
        author: { id: row.author_id, username: row.username, displayName: row.display_name },
        body: row.body,
        positionM: row.position_m === null ? null : Number(row.position_m),
        createdAt: new Date(row.created_at).toISOString(),
      })),
    };
  }

  private timeline(segments: Segment[]) {
    const total = segments.reduce((sum, segment) => sum + segment.distanceM, 0);
    const budget = 400;
    const out: Array<{ t: number; distanceM: number; lat: number; lng: number }> = [];
    if (total === 0) return out;
    let travelled = 0;
    let elapsed = 0;
    for (const segment of segments) {
      for (let i = 0; i < segment.points.length; i += 1) {
        if (i > 0) travelled += haversine(segment.points[i - 1], segment.points[i]);
        const perPoint = segment.points.length > 1 ? segment.durationS / (segment.points.length - 1) : 0;
        if (i > 0) elapsed += perPoint;
        const step = Math.max(1, Math.ceil(total / budget));
        if (i === 0 || travelled >= out.length * step || i === segment.points.length - 1) {
          out.push({
            t: Math.round(elapsed),
            distanceM: Math.round(travelled),
            lat: segment.points[i].lat,
            lng: segment.points[i].lng,
          });
        }
      }
    }
    return out;
  }

  private async persist(tripId: string, segments: Segment[], totals: { distanceM: number; movingDurationS: number; gaps: number; noisyPoints: number }) {
    await this.db.query(`DELETE FROM trip_segments WHERE trip_id = $1`, [tripId]);
    for (const segment of segments) {
      const wkt = `LINESTRING(${segment.points.map((point) => `${point.lng} ${point.lat}`).join(', ')})`;
      await this.db.query(
        `INSERT INTO trip_segments (id, trip_id, seq, distance_m, duration_s, started_at, ended_at, point_geom, gap_before_s, noisy_points)
         VALUES ($1, $2, $3, $4, $5, $6, $7, ST_GeomFromText($8, 4326), $9, $10)`,
        [
          uuidv7(), tripId, segment.seq, segment.distanceM, segment.durationS,
          segment.startedAt, segment.endedAt, wkt, segment.gapBeforeS, segment.noisyPoints,
        ],
      );
    }
    await this.db.query(
      `UPDATE trips SET summary = $2::jsonb, replay_version = replay_version + 1, updated_at = now() WHERE id = $1`,
      [tripId, JSON.stringify({ ...totals, verified: true })],
    );
  }

  async photos(tripId: string, viewerId: string) {
    await this.trip(viewerId, tripId);
    const rows = await this.db.query<PhotoRow>(
      `SELECT tp.id, tp.media_id, tp.position_m, tp.taken_at, tp.created_at,
              m.mime_type, m.width, m.height
       FROM trip_photos tp JOIN media_assets m ON m.id = tp.media_id
       WHERE tp.trip_id = $1 AND m.status = 'ready'
       ORDER BY tp.position_m ASC`,
      [tripId],
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        mediaId: row.media_id,
        positionM: Number(row.position_m),
        takenAt: row.taken_at ? new Date(row.taken_at).toISOString() : null,
        mimeType: row.mime_type,
        width: row.width,
        height: row.height,
        signedUrlPath: `/v1/media/${row.media_id}/url`,
        createdAt: new Date(row.created_at).toISOString(),
      })),
    };
  }

  async addPhoto(userId: string, tripId: string, dto: CreateTripPhotoDto) {
    const rows = await this.db.query<TripRow>(`SELECT * FROM trips WHERE id = $1 AND user_id = $2`, [tripId, userId]);
    if (!rows[0]) {
      throw new NotFoundException({ code: 'TRIP_NOT_FOUND', title: 'Perjalanan tidak ditemukan', detail: 'Perjalanan bukan milik akun ini.' });
    }
    const media = await this.db.query<{ id: string; purpose: string; status: string }>(
      `SELECT id, purpose, status FROM media_assets WHERE id = $1 AND owner_id = $2`,
      [dto.mediaId, userId],
    );
    if (!media[0] || media[0].status !== 'ready' || !['post_photo', 'album_photo'].includes(media[0].purpose)) {
      throw new UnprocessableEntityException({ code: 'MEDIA_NOT_ATTACHABLE', title: 'Media tidak dapat dilampirkan', detail: 'Gunakan foto milik akun ini yang sudah selesai diunggah.' });
    }
    const existing = await this.db.query<{ id: string }>(
      `SELECT id FROM trip_photos WHERE trip_id = $1 AND media_id = $2`,
      [tripId, dto.mediaId],
    );
    if (existing[0]) return { id: existing[0].id, duplicate: true };
    const id = uuidv7();
    try {
      await this.db.query(
        `INSERT INTO trip_photos (id, trip_id, owner_id, media_id, position_m, taken_at)
         VALUES ($1, $2, $3, $4, $5, $6)`,
        [id, tripId, userId, dto.mediaId, dto.positionM, dto.takenAt ?? null],
      );
    } catch (error) {
      if (error instanceof Error && /unique|duplicate/i.test(error.message)) {
        return { id: null, duplicate: true };
      }
      throw error;
    }
    return { id, duplicate: false };
  }

  async share(userId: string, tripId: string, userIds: string[]) {
    const rows = await this.db.query<TripRow>(`SELECT * FROM trips WHERE id = $1 AND user_id = $2`, [tripId, userId]);
    if (!rows[0]) {
      throw new NotFoundException({ code: 'TRIP_NOT_FOUND', title: 'Perjalanan tidak ditemukan', detail: 'Perjalanan bukan milik akun ini.' });
    }
    const unique = [...new Set(userIds)].filter((id) => id !== userId);
    for (const id of unique) {
      const user = await this.db.query<{ id: string }>(`SELECT id FROM users WHERE id = $1 AND status = 'active'`, [id]);
      if (!user[0]) throw new NotFoundException({ code: 'USER_NOT_FOUND', title: 'Pengguna tidak ditemukan', detail: `Akun ${id} tidak tersedia.` });
    }
    await this.db.query(`UPDATE trips SET shared_with = $2::uuid[], updated_at = now() WHERE id = $1`, [tripId, unique]);
    return { tripId, sharedWith: unique };
  }
}
