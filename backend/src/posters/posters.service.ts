import { Inject, Injectable, NotFoundException, UnprocessableEntityException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE, type Database } from '../db/database.js';
import type { CreatePosterDto } from './posters.dto.js';

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
  summary: Record<string, unknown>;
  username: string;
  display_name: string;
};

type PosterRow = {
  id: string;
  trip_id: string;
  owner_id: string;
  template: string;
  title: string;
  subtitle: string | null;
  stats: Record<string, number | string | boolean>;
  media_id: string | null;
  render_state: string;
  render_error: string | null;
  export_count: number;
  exported_at: Date | null;
  created_at: Date;
};

function escapeXml(value: string): string {
  return value
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&apos;');
}

function durationLabel(seconds: number): string {
  const h = Math.floor(seconds / 3600);
  const m = Math.floor((seconds % 3600) / 60);
  return `${h}j ${String(m).padStart(2, '0')}m`;
}

/** Fixed, original template set. No user HTML or remote asset is ever embedded. */
function renderSvg(poster: PosterRow): string {
  const stats = poster.stats as { distanceM?: number; durationS?: number; avgSpeedKph?: number | null; pointCount?: number; startedAt?: string };
  const distance = ((Number(stats.distanceM) || 0) / 1000).toFixed(1);
  const duration = durationLabel(Number(stats.durationS) || 0);
  const speed = stats.avgSpeedKph === null || stats.avgSpeedKph === undefined ? '-' : Number(stats.avgSpeedKph).toFixed(1);
  const title = escapeXml(poster.title);
  const subtitle = escapeXml(poster.subtitle ?? '');
  const date = stats.startedAt ? new Date(stats.startedAt).toLocaleDateString('id-ID') : '';
  const titleBlock = `
    <text x="80" y="1080" fill="#ffffff" font-family="Georgia, serif" font-size="64" font-weight="700">${title}</text>
    <text x="80" y="1140" fill="#c9d4e3" font-family="Helvetica, Arial, sans-serif" font-size="28">${subtitle}</text>
    <text x="80" y="1210" fill="#8fa0b8" font-family="Helvetica, Arial, sans-serif" font-size="22">${escapeXml(date)}</text>`;
  const statBlock = (x: number, label: string, value: string, unit: string) => `
    <text x="${x}" y="1240" fill="#8fa0b8" font-family="Helvetica, Arial, sans-serif" font-size="20">${label}</text>
    <text x="${x}" y="1290" fill="#ffffff" font-family="Helvetica, Arial, sans-serif" font-size="46" font-weight="700">${value}<tspan font-size="22" fill="#8fa0b8"> ${unit}</tspan></text>`;

  if (poster.template === 'first_light') {
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350" role="img" aria-label="${title}">
  <defs><linearGradient id="sky" x1="0" y1="0" x2="0" y2="1">
    <stop offset="0" stop-color="#1f2d5a"/><stop offset="0.55" stop-color="#d4694a"/><stop offset="1" stop-color="#f4b26b"/>
  </linearGradient></defs>
  <rect width="1080" height="1350" fill="url(#sky)"/>
  <circle cx="760" cy="600" r="130" fill="#ffd9a0" opacity="0.9"/>
  <path d="M0 760 L250 640 L520 720 L790 610 L1080 690 L1080 1350 L0 1350 Z" fill="#101828" opacity="0.92"/>
  <path d="M0 840 L300 760 L620 830 L1080 760" fill="none" stroke="#f4b26b" stroke-width="6" opacity="0.8"/>
  ${titleBlock}${statBlock(80, 'JARAK', distance, 'km')}${statBlock(420, 'DURASI', duration, '')}${statBlock(760, 'RATA-RATA', speed, 'km/j')}
</svg>`;
  }
  if (poster.template === 'peloton_lines') {
    const lines = Array.from({ length: 9 }, (_, i) => `<line x1="${-200 + i * 160}" y1="1350" x2="${300 + i * 160}" y2="0" stroke="#3ddc97" stroke-width="2" opacity="${0.15 + i * 0.06}"/>`).join('');
    return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350" role="img" aria-label="${title}">
  <rect width="1080" height="1350" fill="#0b1210"/>
  ${lines}
  <circle cx="820" cy="420" r="180" fill="none" stroke="#3ddc97" stroke-width="4" opacity="0.5"/>
  <text x="80" y="230" fill="#3ddc97" font-family="Helvetica, Arial, sans-serif" font-size="26" letter-spacing="8">RIDERJOURNEY</text>
  ${titleBlock}${statBlock(80, 'JARAK', distance, 'km')}${statBlock(420, 'DURASI', duration, '')}${statBlock(760, 'RATA-RATA', speed, 'km/j')}
</svg>`;
  }
  const ticks = Array.from({ length: 31 }, (_, i) => {
    const angle = (Math.PI * 2 * i) / 30;
    const x1 = 540 + Math.cos(angle) * 300;
    const y1 = 520 + Math.sin(angle) * 300;
    const x2 = 540 + Math.cos(angle) * (i % 5 === 0 ? 260 : 280);
    const y2 = 520 + Math.sin(angle) * (i % 5 === 0 ? 260 : 280);
    return `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}" stroke="#7aa2ff" stroke-width="${i % 5 === 0 ? 5 : 2}"/>`;
  }).join('');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1080" height="1350" viewBox="0 0 1080 1350" role="img" aria-label="${title}">
  <rect width="1080" height="1350" fill="#060b1c"/>
  <circle cx="540" cy="520" r="330" fill="none" stroke="#1b2a52" stroke-width="2"/>
  ${ticks}
  <text x="540" y="500" text-anchor="middle" fill="#7aa2ff" font-family="Helvetica, Arial, sans-serif" font-size="26" letter-spacing="6">ODOMETER</text>
  <text x="540" y="590" text-anchor="middle" fill="#ffffff" font-family="Helvetica, Arial, sans-serif" font-size="92" font-weight="700">${distance}</text>
  <text x="540" y="640" text-anchor="middle" fill="#7aa2ff" font-family="Helvetica, Arial, sans-serif" font-size="28">KILOMETER</text>
  ${titleBlock}${statBlock(80, 'DURASI', duration, '')}${statBlock(420, 'RATA-RATA', speed, 'km/j')}${statBlock(760, 'TITIK', String(stats.pointCount ?? '-'), '')}
</svg>`;
}

@Injectable()
export class PostersService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private async trip(userId: string, tripId: string): Promise<TripRow> {
    const rows = await this.db.query<TripRow>(
      `SELECT t.*, u.username, u.display_name FROM trips t JOIN users u ON u.id = t.user_id
       WHERE t.id = $1 AND t.user_id = $2`,
      [tripId, userId],
    );
    if (!rows[0]) throw new NotFoundException({ code: 'TRIP_NOT_FOUND', title: 'Perjalanan tidak ditemukan', detail: 'Perjalanan bukan milik akun ini.' });
    return rows[0];
  }

  private stats(trip: TripRow): Record<string, number | string | boolean | null> {
    const qualities = trip.summary as { gaps?: number; noisyPoints?: number; distanceM?: number; movingDurationS?: number } | null;
    const distanceM = Number(qualities?.distanceM ?? trip.distance_m ?? 0);
    const durationS = Number(qualities?.movingDurationS ?? trip.duration_s ?? 0);
    return {
      distanceM,
      durationS,
      avgSpeedKph: durationS > 0 ? Math.round((distanceM / 1000 / (durationS / 3600)) * 10) / 10 : null,
      gaps: Number(qualities?.gaps ?? 0),
      noisyPoints: Number(qualities?.noisyPoints ?? 0),
      pointCount: Number(trip.point_count ?? 0),
      startedAt: new Date(trip.started_at).toISOString(),
      verified: true,
      source: 'server',
    };
  }

  private present(row: PosterRow) {
    return {
      id: row.id,
      tripId: row.trip_id,
      template: row.template,
      title: row.title,
      subtitle: row.subtitle,
      stats: row.stats,
      renderState: row.render_state,
      exportCount: row.export_count,
      exportedAt: row.exported_at ? new Date(row.exported_at).toISOString() : null,
      renderPath: `/v1/posters/${row.id}/render.svg`,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async create(userId: string, tripId: string, dto: CreatePosterDto) {
    const trip = await this.trip(userId, tripId);
    if (trip.status !== 'finished') {
      throw new UnprocessableEntityException({ code: 'TRIP_NOT_FINISHED', title: 'Perjalanan belum selesai', detail: 'Poster hanya dibuat dari perjalanan yang selesai.' });
    }
    const existing = await this.db.query<PosterRow>(
      `SELECT * FROM posters WHERE owner_id = $1 AND client_poster_id = $2`,
      [userId, dto.clientPosterId],
    );
    if (existing[0]) return { ...this.present(existing[0]), duplicate: true };
    const id = uuidv7();
    await this.db.query(
      `INSERT INTO posters (id, trip_id, owner_id, template, title, subtitle, stats, render_state, client_poster_id)
       VALUES ($1, $2, $3, $4, $5, $6, $7::jsonb, 'ready', $8)`,
      [id, tripId, userId, dto.template, dto.title, dto.subtitle ?? null, JSON.stringify(this.stats(trip)), dto.clientPosterId],
    );
    return { ...this.present(await this.one(userId, id)), duplicate: false };
  }

  private async one(userId: string, posterId: string): Promise<PosterRow> {
    const rows = await this.db.query<PosterRow>(
      `SELECT * FROM posters WHERE id = $1 AND owner_id = $2`,
      [posterId, userId],
    );
    if (!rows[0]) throw new NotFoundException({ code: 'POSTER_NOT_FOUND', title: 'Poster tidak ditemukan', detail: 'Poster tidak tersedia untuk akun ini.' });
    return rows[0];
  }

  async get(userId: string, posterId: string) {
    return this.present(await this.one(userId, posterId));
  }

  async forTrip(userId: string, tripId: string) {
    await this.trip(userId, tripId);
    const rows = await this.db.query<PosterRow>(
      `SELECT * FROM posters WHERE trip_id = $1 AND owner_id = $2 ORDER BY created_at DESC`,
      [tripId, userId],
    );
    return { items: rows.map((row) => this.present(row)) };
  }

  async svg(userId: string, posterId: string) {
    return renderSvg(await this.one(userId, posterId));
  }

  /**
   * The server cannot write to the device gallery, so export records the
   * intent idempotently and hands the client a stable render path plus a
   * filename. The file itself is generated on demand and never stored.
   */
  async export(userId: string, posterId: string) {
    const poster = await this.one(userId, posterId);
    await this.db.query(
      `UPDATE posters SET exported_at = now(), export_count = export_count + 1, updated_at = now() WHERE id = $1`,
      [posterId],
    );
    const slug = poster.title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'poster';
    return {
      id: poster.id,
      renderPath: `/v1/posters/${poster.id}/render.svg`,
      filename: `riderjourney-${slug}.svg`,
      mimeType: 'image/svg+xml',
      exportCount: poster.export_count + 1,
      note: 'Unduh renderPath lalu simpan ke galeri perangkat.',
    };
  }
}
