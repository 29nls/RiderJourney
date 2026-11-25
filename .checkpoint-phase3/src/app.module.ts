import { MiddlewareConsumer, Module, NestModule } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { CoreModule } from './core.module.js';
import { AuthModule } from './auth/auth.module.js';
import { UsersModule } from './users/users.module.js';
import { VehiclesModule } from './vehicles/vehicles.module.js';
import { PlacesModule } from './places/places.module.js';
import { RoutesModule } from './routes/routes.module.js';
import { TripsModule } from './trips/trips.module.js';
import { ConvoysModule } from './convoys/convoys.module.js';
import { RealtimeModule } from './realtime/realtime.module.js';
import { HealthController } from './health/health.controller.js';
import { ConfigController } from './config/config.controller.js';
import { RequestIdMiddleware } from './common/request-id.middleware.js';
import { LoggingMiddleware } from './common/logging.middleware.js';

@Module({
  imports: [
    ThrottlerModule.forRoot([
      { ttl: 60_000, limit: 120, skipIf: () => process.env.NODE_ENV === 'test' },
    ]),
    CoreModule,
    AuthModule,
    UsersModule,
    VehiclesModule,
    PlacesModule,
    RoutesModule,
    TripsModule,
    ConvoysModule,
    RealtimeModule,
  ],
  controllers: [HealthController, ConfigController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, LoggingMiddleware).forRoutes('*');
  }
}
