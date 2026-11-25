import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { ConvoysController } from './convoys.controller.js';
import { ConvoysService } from './convoys.service.js';
import { EntitlementService } from './entitlement.service.js';

@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [ConvoysController],
  providers: [ConvoysService, EntitlementService],
  exports: [ConvoysService],
})
export class ConvoysModule {}
