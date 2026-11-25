import { Controller, Get, Inject } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from './env.js';

@Controller('v1/config')
export class ConfigController {
  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  @Get('bootstrap')
  bootstrap() {
    return {
      minAppVersion: 1,
      latestAppVersion: 1,
      features: { convoy: true, voice: false, feed: false, billing: false },
      limits: {
        waypoints: 7,
        tripPointBatch: 500,
        convoyCapacityDefault: this.config.convoyCapacityDefault,
        convoyCapacityMax: this.config.convoyCapacityMax,
        realtimeTicketTtlSeconds: this.config.realtimeTicketTtlSeconds,
      },
      thresholds: {
        staleAfterSeconds: this.config.staleAfterSeconds,
        hazardTtlSeconds: 7200,
        locationPositionTtlSeconds: this.config.positionTtlSeconds,
      },
      map: {
        styleUrl: this.config.mapTileStyleUrl,
        attribution: this.config.mapAttribution,
        configured: Boolean(this.config.mapTileStyleUrl),
      },
      providers: {
        routing: this.config.routingProvider || null,
        geocoding: this.config.geocodingProvider || null,
      },
      serverTime: new Date().toISOString(),
    };
  }
}
