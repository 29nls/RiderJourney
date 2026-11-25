import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { AuthModule } from '../auth/auth.module.js';
import { GEOCODING_PROVIDER } from '../providers/types.js';
import { PhotonGeocodingProvider } from '../providers/photon.provider.js';
import { UnconfiguredGeocodingProvider } from '../providers/unconfigured.provider.js';
import { PlacesController } from './places.controller.js';
import { PlacesService } from './places.service.js';

@Module({
  imports: [AuthModule],
  controllers: [PlacesController],
  providers: [
    PlacesService,
    {
      provide: GEOCODING_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.geocodingBaseUrl
          ? new PhotonGeocodingProvider(config.geocodingBaseUrl, config.geocodingApiKey)
          : new UnconfiguredGeocodingProvider(),
    },
  ],
})
export class PlacesModule {}
