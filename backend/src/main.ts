import 'reflect-metadata';
import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module.js';
import { APP_CONFIG, type AppConfig } from './config/env.js';
import { configureApp } from './app.setup.js';
import { MediaDeletionWorker } from './media/deletion-outbox.js';
import { MediaScanWorker } from './media/scan-worker.js';
import { UploadCleanupService } from './media/upload-cleanup.js';
import { AlertService } from './media/alerting.js';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error', 'warn', 'log'] });
  const config = app.get<AppConfig>(APP_CONFIG);
  configureApp(app, config);

  const swaggerConfig = new DocumentBuilder()
    .setTitle('RiderJourney API')
    .setDescription('REST API v1 Fase 2 — Convoy & Live Location')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('docs', app, document);

  const host = process.env.HOST ?? '127.0.0.1';
  await app.listen(config.port, host);
  Logger.log(`RiderJourney API listening on http://${host}:${config.port}`, 'Bootstrap');

  // Start scheduled workers when storage is configured.
  if (config.mediaS3Bucket && config.mediaS3AccessKey && config.mediaS3SecretKey) {
    const deletionWorker = app.get(MediaDeletionWorker);
    deletionWorker.startScheduled();
    const cleanupService = app.get(UploadCleanupService);
    cleanupService.startScheduled();
    // The scan worker is harmless without a provider (it reports unavailable and
    // leaves media 'unscanned'), so it runs whenever storage is configured.
    app.get(MediaScanWorker).startScheduled();
    // Alert evaluation runs with storage configured: without storage the worker
    // health it reads is already 'unavailable', and alerting on that every boot
    // would be noise rather than signal.
    app.get(AlertService).startScheduled();
  }

  // Graceful shutdown.
  const shutdown = async () => {
    Logger.log('Shutting down…', 'Bootstrap');
    try {
      const deletionWorker = app.get(MediaDeletionWorker);
      await deletionWorker.stopScheduled();
      const cleanupService = app.get(UploadCleanupService);
      await cleanupService.stopScheduled();
      await app.get(MediaScanWorker).stopScheduled();
      await app.get(AlertService).stopScheduled();
    } catch { /* worker may not be initialized */ }
    await app.close();
  };
  process.on('SIGTERM', () => void shutdown());
  process.on('SIGINT', () => void shutdown());
}

bootstrap().catch((error: unknown) => {
  Logger.error(error instanceof Error ? error.message : String(error), undefined, 'Bootstrap');
  process.exitCode = 1;
});
