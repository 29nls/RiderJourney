import { Module } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { AuthModule } from '../auth/auth.module.js';
import { RealtimeModule } from '../realtime/realtime.module.js';
import { MediaAccessController, MediaController } from './media.controller.js';
import { MediaService } from './media.service.js';
import { MediaDeletionWorker } from './deletion-outbox.js';
import { OBJECT_STORAGE, createObjectStorage } from './object-storage.js';
import { UploadCleanupService } from './upload-cleanup.js';
import { StorageQuotaService } from './storage-quota.js';
import { ClamAvMediaScanner, MEDIA_SCANNER, NoOpMediaScanner, type MediaScanner } from './media-scanner.js';
import { MediaScanWorker } from './scan-worker.js';
import { ModerationService } from './moderation.service.js';
import { ALERT_NOTIFIER, AlertService, NoopAlertNotifier } from './alerting.js';

/**
 * Scanner selection is configuration, not code: MEDIA_SCANNER=clamav with a
 * reachable daemon turns scanning on; anything else keeps the no-op scanner so
 * media stays 'unscanned' rather than silently passing.
 */
export function createMediaScanner(config: AppConfig): MediaScanner {
  if (config.mediaScanner === 'clamav' && config.clamavHost) {
    return new ClamAvMediaScanner({
      host: config.clamavHost,
      port: config.clamavPort,
      timeoutMs: config.clamavTimeoutMs,
    });
  }
  return new NoOpMediaScanner();
}

@Module({
  imports: [AuthModule, RealtimeModule],
  controllers: [MediaController, MediaAccessController],
  providers: [
    { provide: OBJECT_STORAGE, inject: [APP_CONFIG], useFactory: (config: AppConfig) => createObjectStorage(config) },
    { provide: MEDIA_SCANNER, inject: [APP_CONFIG], useFactory: (config: AppConfig) => createMediaScanner(config) },
    // No delivery provider is configured, so the notifier honestly reports
    // itself unavailable; alerts still land in ops_alert_events.
    { provide: ALERT_NOTIFIER, useValue: new NoopAlertNotifier() },
    MediaService,
    ModerationService,
    MediaDeletionWorker,
    MediaScanWorker,
    UploadCleanupService,
    StorageQuotaService,
    AlertService,
  ],
  exports: [
    MediaService, ModerationService, MediaDeletionWorker, MediaScanWorker,
    UploadCleanupService, StorageQuotaService, AlertService,
    OBJECT_STORAGE, MEDIA_SCANNER, ALERT_NOTIFIER,
  ],
})
export class MediaModule {}
