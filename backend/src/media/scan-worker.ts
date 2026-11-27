import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.js';
import { OBJECT_STORAGE, type ObjectStorage } from './object-storage.js';
import { MEDIA_SCANNER, type MediaScanner } from './media-scanner.js';

type ScanRow = {
  id: string;
  object_key: string;
  mime_type: string;
  scan_attempts: number;
};

/**
 * Scans completed media in the background.
 *
 * `complete()` does not scan inline: a 100 MB video would hold a request open
 * for the length of a ClamAV run. The row becomes 'ready' with scan_status
 * 'unscanned' and this worker claims it. 'scanning' is a lease — a worker that
 * dies mid-scan leaves a row that another run reclaims instead of a row stuck
 * forever.
 *
 * Fail-closed: a scanner that is unreachable, or a scan that keeps failing,
 * never produces 'clean'. Media only leaves 'unscanned' when a result proves it.
 */
@Injectable()
export class MediaScanWorker {
  private readonly logger = new Logger(MediaScanWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private stopping = false;
  private lastRunAt: Date | null = null;
  private lastResult: { scanned: number; clean: number; quarantined: number; failed: number; skipped: number } | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    @Inject(MEDIA_SCANNER) private readonly scanner: MediaScanner,
  ) {}

  async scanBatch(limit = this.config.mediaScanBatchSize) {
    if (!this.scanner.available()) {
      // Nothing is reclassified when no scanner exists: media stays 'unscanned'
      // and the public read path keeps refusing it.
      return { scanned: 0, clean: 0, quarantined: 0, failed: 0, skipped: 0 };
    }

    let clean = 0;
    let quarantined = 0;
    let failed = 0;
    let skipped = 0;
    let scanned = 0;

    for (let i = 0; i < limit; i += 1) {
      const claimed = await this.db.query<ScanRow>(
        `UPDATE media_assets AS m
         SET scan_status = 'scanning', scan_attempts = m.scan_attempts + 1,
             scan_next_at = now() + interval '5 minutes'
         WHERE m.id = (
           SELECT id FROM media_assets
           WHERE status = 'ready'
             AND scan_status IN ('unscanned', 'scanning')
             AND (scan_next_at IS NULL OR scan_next_at <= now())
           ORDER BY created_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         RETURNING m.id, m.object_key, m.mime_type, m.scan_attempts`,
      );
      const row = claimed[0];
      if (!row) break;
      scanned += 1;

      const result = await this.scanner.scan(row.object_key, row.mime_type, () => this.storage.openRead(row.object_key));

      if (result.status === 'clean') {
        await this.db.query(
          `UPDATE media_assets SET scan_status = 'clean', scanned_at = now(),
             scan_last_error = NULL, scan_next_at = NULL
           WHERE id = $1`,
          [row.id],
        );
        clean += 1;
      } else if (result.status === 'quarantined') {
        await this.db.query(
          `UPDATE media_assets SET scan_status = 'quarantined', scanned_at = now(),
             scan_last_error = $2, scan_next_at = NULL
           WHERE id = $1`,
          [row.id, (result.details ?? 'malware').slice(0, 300)],
        );
        quarantined += 1;
        this.logger.warn(`Quarantined media ${row.id}: ${result.details ?? 'malware'}`);
      } else {
        const exhausted = row.scan_attempts >= this.config.mediaScanMaxAttempts;
        if (exhausted) {
          await this.db.query(
            `UPDATE media_assets SET scan_status = 'scan_failed', scanned_at = now(),
               scan_last_error = $2, scan_next_at = NULL
             WHERE id = $1`,
            [row.id, (result.details ?? 'scan failed').slice(0, 300)],
          );
          failed += 1;
        } else {
          // Temporary failure: hand the row back as unscanned with a delay so
          // the next run retries instead of treating it as safe.
          await this.db.query(
            `UPDATE media_assets SET scan_status = 'unscanned',
               scan_last_error = $2,
               scan_next_at = now() + ($3 || ' seconds')::interval
             WHERE id = $1`,
            [row.id, (result.details ?? 'scan failed').slice(0, 300), this.config.mediaScanRetrySeconds],
          );
          skipped += 1;
        }
      }
    }

    return { scanned, clean, quarantined, failed, skipped };
  }

  startScheduled(pollSeconds = this.config.mediaScanPollSeconds, batchSize = this.config.mediaScanBatchSize) {
    if (this.timer) return;
    this.stopping = false;
    const run = async () => {
      if (this.running || this.stopping) return;
      this.running = true;
      try {
        this.lastResult = await this.scanBatch(batchSize);
        this.lastRunAt = new Date();
      } catch (error) {
        this.logger.error('Scan worker error', error instanceof Error ? error.message : String(error));
      } finally {
        this.running = false;
      }
    };
    this.timer = setInterval(run, pollSeconds * 1000);
    void run();
    this.logger.log(`Scan worker every ${pollSeconds}s, batch ${batchSize}, provider ${this.scanner.name}`);
  }

  async stopScheduled() {
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    for (let i = 0; i < 300 && this.running; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
    this.stopping = false;
  }

  async status() {
    const rows = await this.db.query<{
      unscanned: number;
      clean: number;
      quarantined: number;
      scan_failed: number;
    }>(
      `SELECT
         count(*) FILTER (WHERE scan_status = 'unscanned')::int AS unscanned,
         count(*) FILTER (WHERE scan_status = 'clean')::int AS clean,
         count(*) FILTER (WHERE scan_status = 'quarantined')::int AS quarantined,
         count(*) FILTER (WHERE scan_status = 'scan_failed')::int AS scan_failed
       FROM media_assets WHERE status = 'ready'`,
    );
    const r = rows[0]!;
    return {
      provider: this.scanner.name,
      available: this.scanner.available(),
      status: !this.scanner.available() ? 'unavailable' : this.timer === null ? 'degraded' : 'healthy',
      scheduled: this.timer !== null,
      running: this.running,
      lastRunAt: this.lastRunAt,
      lastResult: this.lastResult,
      unscanned: r.unscanned,
      clean: r.clean,
      quarantined: r.quarantined,
      failed: r.scan_failed,
    };
  }
}
