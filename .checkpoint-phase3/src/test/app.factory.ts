import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { AppModule } from '../app.module.js';
import { APP_CONFIG, loadConfig, type AppConfig } from '../config/env.js';
import { configureApp } from '../app.setup.js';
import { DATABASE, type Database } from '../db/database.js';
import {
  GEOCODING_PROVIDER,
  ROUTING_PROVIDER,
  type GeocodingProvider,
  type PlaceResult,
  type RouteOption,
  type RouteRequest,
  type RoutingProvider,
} from '../providers/types.js';

export class SwitchableRoutingProvider implements RoutingProvider {
  readonly name = 'test-routing';
  mode: 'ok' | 'empty' | 'error' = 'ok';

  async preview(request: RouteRequest): Promise<RouteOption[]> {
    if (this.mode === 'empty') return [];
    if (this.mode === 'error') {
      const { ProviderFailure } = await import('../providers/types.js');
      throw new ProviderFailure('PROVIDER_UNAVAILABLE', 'Provider uji gagal.');
    }
    const points = [request.origin, ...request.waypoints, request.destination];
    const coordinates = points.map((p) => [p.lng, p.lat]);
    const base = {
      geometry: { type: 'LineString' as const, coordinates },
      provider: this.name,
    };
    return [
      { ...base, distanceM: 120_000, durationS: 7_200 },
      ...(request.alternatives ? [{ ...base, distanceM: 135_000, durationS: 7_800 }] : []),
    ];
  }
}

export class StubGeocodingProvider implements GeocodingProvider {
  readonly name = 'test-geocoding';
  async search(query: string): Promise<PlaceResult[]> {
    if (query === 'kosong') return [];
    return [{ providerRef: 'test/1', name: 'Monas', category: 'monument', location: { lat: -6.1754, lng: 106.8272 } }];
  }
}

export async function buildTestApp(
  db: Database,
  routing = new SwitchableRoutingProvider(),
  geocoding = new StubGeocodingProvider(),
): Promise<{ app: INestApplication; config: AppConfig; routing: SwitchableRoutingProvider }> {
  process.env.AUTH_JWT_SECRET = process.env.AUTH_JWT_SECRET ?? 'test-secret-with-at-least-32-characters';
  process.env.AUTH_EXPOSE_DEV_TOKENS = 'true';
  process.env.PLATE_ENCRYPTION_KEY = process.env.PLATE_ENCRYPTION_KEY ?? Buffer.alloc(32, 7).toString('base64');

  const moduleRef = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(DATABASE)
    .useValue(db)
    .overrideProvider(ROUTING_PROVIDER)
    .useValue(routing)
    .overrideProvider(GEOCODING_PROVIDER)
    .useValue(geocoding)
    .compile();

  const app = moduleRef.createNestApplication();
  const config = app.get<AppConfig>(APP_CONFIG);
  configureApp(app, config);
  await app.init();
  return { app, config, routing };
}
