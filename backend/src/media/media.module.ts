import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { MediaAccessController, MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';

@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [MediaController, MediaAccessController],
  providers: [MediaService],
  exports: [MediaService],
})
export class MediaModule {}
