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
import { ChatModule } from './chat/chat.module.js';
import { HazardsModule } from './hazards/hazards.module.js';
import { VoiceModule } from './voice/voice.module.js';
import { MediaModule } from './media/media.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { SocialModule } from './social/social.module.js';
import { CommunityModule } from './communities/community.module.js';
import { PostsModule } from './posts/posts.module.js';
import { AlbumsModule } from './albums/albums.module.js';
import { ReplayModule } from './replay/replay.module.js';
import { PostersModule } from './posters/posters.module.js';
import { RewardsModule } from './rewards/rewards.module.js';
import { BillingModule } from './billing/billing.module.js';
import { RedeemModule } from './redeem/redeem.module.js';
import { OpsModule } from './ops/ops.module.js';
import { AdminModule } from './admin/admin.module.js';
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
    ChatModule,
    HazardsModule,
    VoiceModule,
    MediaModule,
    NotificationsModule,
    SocialModule,
    CommunityModule,
    PostsModule,
    AlbumsModule,
    ReplayModule,
    PostersModule,
    RewardsModule,
    BillingModule,
    RedeemModule,
    OpsModule,
    AdminModule,
  ],
  controllers: [HealthController, ConfigController],
  providers: [{ provide: APP_GUARD, useClass: ThrottlerGuard }],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer): void {
    consumer.apply(RequestIdMiddleware, LoggingMiddleware).forRoutes('*');
  }
}
