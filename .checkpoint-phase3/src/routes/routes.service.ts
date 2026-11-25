import { Inject, Injectable, InternalServerErrorException, NotFoundException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.js';
import { ProviderFailure, ROUTING_PROVIDER, type RouteOption, type RoutingProvider } from '../providers/types.js';
import { throwProviderError } from '../providers/error.js';
import type { RoutePreviewDto } from './routes.dto.js';

const DISCLAIMER =
  'Data akses jalan dapat tidak lengkap; patuhi rambu dan kondisi lapangan. Rute bukan jaminan legalitas atau keselamatan.';

function wktLine(coordinates: number[][]): string | null {
  if (coordinates.length < 2) return null;
  const points = coordinates
    .filter((c) => Array.isArray(c) && c.length >= 2 && Number.isFinite(c[0]) && Number.isFinite(c[1]))
    .map(([lng, lat]) => `${lng} ${lat}`);
  if (points.length < 2) return null;
  return `LINESTRING(${points.join(',')})`;
}

@Injectable()
export class RoutesService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ROUTING_PROVIDER) private readonly routing: RoutingProvider,
  ) {}

  async get(routeId: string, userId: string) {
    const rows = await this.db.query<{
      id: string;
      owner_id: string;
      name: string | null;
      distance_m: number;
      duration_s: number;
      provider: string;
      waypoints: unknown;
      geojson: string;
    }>(
      `SELECT r.id, r.owner_id, r.name, r.distance_m, r.duration_s, r.provider, r.waypoints,
              ST_AsGeoJSON(r.route_geometry) AS geojson
       FROM routes r
       WHERE r.id = $1 AND (
         r.owner_id = $2 OR EXISTS (
           SELECT 1 FROM convoys c
           JOIN convoy_members m ON m.convoy_id = c.id
           WHERE c.route_id = r.id AND m.user_id = $2 AND m.status = 'active'
             AND c.status IN ('lobby', 'active', 'paused')
         )
       )`,
      [routeId, userId],
    );
    const row = rows[0];
    if (!row) {
      throw new NotFoundException({
        code: 'ROUTE_NOT_FOUND',
        title: 'Rute tidak ditemukan',
        detail: 'Rute tidak ada atau tidak dibagikan kepada Anda.',
      });
    }
    let geometry: unknown;
    try {
      geometry = JSON.parse(row.geojson);
    } catch {
      throw new InternalServerErrorException({
        code: 'ROUTE_GEOMETRY_INVALID',
        title: 'Geometri rute tidak valid',
        detail: 'Data rute tersimpan tidak dapat dibaca.',
      });
    }
    return {
      id: row.id,
      ownerId: row.owner_id,
      name: row.name,
      distanceM: row.distance_m,
      durationS: row.duration_s,
      provider: row.provider,
      waypoints: row.waypoints,
      geometry,
    };
  }

  async preview(userId: string, dto: RoutePreviewDto) {
    const waypoints = dto.waypoints ?? [];
    let options: RouteOption[];
    try {
      options = await this.routing.preview({
        origin: dto.origin,
        destination: dto.destination,
        waypoints,
        alternatives: dto.alternatives ?? true,
      });
    } catch (error) {
      throwProviderError(error);
    }

    if (options.length === 0) {
      return { routes: [], providerStatus: 'empty', disclaimer: DISCLAIMER };
    }

    const routes: Array<{ id: string; distanceM: number; durationS: number; geometry: RouteOption['geometry']; provider: string; disclaimer: string }> = [];
    for (const option of options) {
      const wkt = wktLine(option.geometry.coordinates);
      if (!wkt) {
        throwProviderError(new ProviderFailure('PROVIDER_INVALID_RESPONSE', 'Provider mengembalikan geometri tidak valid.'));
      }
      const id = uuidv7();
      await this.db.query(
        `INSERT INTO routes (id, owner_id, name, route_geometry, waypoints, distance_m, duration_s, provider)
         VALUES ($1, $2, NULL, ST_GeomFromText($3, 4326), $4::jsonb, $5, $6, $7)`,
        [id, userId, wkt, JSON.stringify(waypoints), option.distanceM, option.durationS, option.provider],
      );
      routes.push({
        id,
        distanceM: option.distanceM,
        durationS: option.durationS,
        geometry: option.geometry,
        provider: option.provider,
        disclaimer: DISCLAIMER,
      });
    }
    return { routes, providerStatus: 'ok', disclaimer: DISCLAIMER };
  }
}
