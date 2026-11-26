import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { AuthModule } from '../auth/auth.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { MediaAccessController, MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { MediaDeletionWorker } from './deletion-outbox.js';
import { OBJECT_STORAGE, createObjectStorage } from './object-storage.js';

@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [MediaController, MediaAccessController],
  providers: [
    { provide: OBJECT_STORAGE, inject: [APP_CONFIG], useFactory: (config: AppConfig) => createObjectStorage(config) },
    MediaService,
    MediaDeletionWorker,
  ],
  exports: [MediaService, MediaDeletionWorker, OBJECT_STORAGE],
})
export class MediaModule {}
