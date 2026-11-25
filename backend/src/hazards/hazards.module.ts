import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { HazardsController } from './hazards.controller.js';
import { HazardsService } from './hazards.service.js';

@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [HazardsController],
  providers: [HazardsService],
})
export class HazardsModule {}
