import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { AuthModule } from '../auth/auth.module.js';
import { ROUTING_PROVIDER } from '../providers/types.js';
import { OsrmRoutingProvider } from '../providers/osrm.provider.js';
import { UnconfiguredRoutingProvider } from '../providers/unconfigured.provider.js';
import { RoutesController } from './routes.controller.js';
import { RoutesService } from './routes.service.js';

@Module({
  imports: [AuthModule],
  controllers: [RoutesController],
  providers: [
    RoutesService,
    {
      provide: ROUTING_PROVIDER,
      inject: [APP_CONFIG],
      useFactory: (config: AppConfig) =>
        config.routingBaseUrl
          ? new OsrmRoutingProvider(config.routingBaseUrl, config.routingApiKey)
          : new UnconfiguredRoutingProvider(),
    },
  ],
})
export class RoutesModule {}
