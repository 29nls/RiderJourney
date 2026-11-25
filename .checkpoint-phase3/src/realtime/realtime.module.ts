import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RealtimeController } from './realtime.controller.js';
import { RealtimeGateway } from './realtime.gateway.js';
import { RealtimeHub } from './realtime.hub.js';
import { RealtimeService } from './realtime.service.js';
import { realtimeStoreFactory, REALTIME_STORE } from './realtime.store.js';

@Module({
  imports: [AuthModule],
  controllers: [RealtimeController],
  providers: [realtimeStoreFactory, RealtimeHub, RealtimeService, RealtimeGateway],
  exports: [REALTIME_STORE, RealtimeHub, RealtimeService],
})
export class RealtimeModule {}
