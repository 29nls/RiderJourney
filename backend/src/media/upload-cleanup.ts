import { Inject, Injectable, Logger } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.js';
import { OBJECT_STORAGE, type ObjectStorage } from './object-storage.js';
import { enqueueMediaDeletion } from './deletion-outbox.js';
import { StorageQuotaService } from './storage-quota.js';

type ExpiredRow = {
  id: string;
  object_key: string;
  owner_id: string;
  size_bytes: number;
  status: string;
};

@Injectable()
export class UploadCleanupService {
  private readonly logger = new Logger(UploadCleanupService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private lastRunAt: Date | null = null;
  private lastResult: { expired: number; orphansEnqueued: number; noObject: number } | null = null;
  private lastErrorAt: Date | null = null;
  private lastError: string | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
    private readonly quota: StorageQuotaService,
  ) {}

  /**
   * Find expired pending uploads, check storage for orphan objects, and
   * enqueue deletion. Uses atomic state transition to avoid racing with
   * concurrent completion.
   */
  async cleanupExpired(limit = 50) {
    const candidates = await this.db.query<ExpiredRow>(
      `SELECT id, object_key, owner_id, size_bytes, status FROM media_assets
       WHERE status = 'pending'
         AND upload_expires_at IS NOT NULL
         AND upload_expires_at <= now()
       ORDER BY upload_expires_at ASC
       LIMIT $1`,
      [limit],
    );

    let expired = 0;
    let orphansEnqueued = 0;
    let noObject = 0;

    for (const row of candidates) {
      // HEAD happens before any lock: no database transaction is held while
      // talking to storage. A failed check leaves the row pending so the next
      // run retries it instead of silently losing the orphan.
      let exists: boolean;
      try {
        exists = (await this.storage.head(row.object_key)) !== null;
      } catch (error) {
        this.logger.warn(`Storage check failed for ${row.object_key}: ${error instanceof Error ? error.message : error}`);
        continue;
      }

      // CAS is guarded by object_key as well as status: a client retry can
      // re-arm this row with a NEW key at any moment, and that fresh intent
      // must never be expired by a stale HEAD result.
      const claimed = await this.db.transaction(async (tx) => {
        const updated = await tx.query<{ id: string }>(
          `UPDATE media_assets SET status = 'expired'
           WHERE id = $1 AND status = 'pending' AND object_key = $2 AND upload_expires_at <= now()
           RETURNING id`,
          [row.id, row.object_key],
        );
        if (!updated[0]) return false;
        // Same transaction as the state transition: an expired intent and the
        // orphan deletion it implies commit together or not at all.
        if (exists) await enqueueMediaDeletion(tx, [row.object_key], 'expired_upload');
        return true;
      });
      if (!claimed) continue;

      expired++;
      if (exists) orphansEnqueued++;
      else noObject++;
      // The failed intent's reservation would otherwise block the quota forever.
      // Idempotent clamp; a crash before this line is fixed by reconcile.
      await this.quota.releaseReservation(row.owner_id, row.size_bytes);
    }

    return { expired, orphansEnqueued, noObject };
  }

  startScheduled(intervalSeconds = this.config.mediaUploadCleanupIntervalSeconds) {
    if (this.timer) return;
    const run = async () => {
      try {
        const result = await this.cleanupExpired();
        this.lastRunAt = new Date();
        this.lastResult = result;
        this.lastError = null;
        if (result.expired > 0) {
          this.logger.log(`Cleanup: ${result.expired} expired, ${result.orphansEnqueued} orphans enqueued`);
        }
      } catch (error) {
        this.lastErrorAt = new Date();
        this.lastError = (error instanceof Error ? error.message : String(error)).slice(0, 300);
        this.logger.error('Upload cleanup error', this.lastError);
      }
    };
    this.timer = setInterval(run, intervalSeconds * 1000);
    void run();
  }

  async stopScheduled() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /** Operator-facing health for the scheduled cleanup. */
  status() {
    const state = this.timer === null ? 'unavailable' : this.lastError ? 'degraded' : 'healthy';
    return {
      status: state,
      scheduled: this.timer !== null,
      lastRunAt: this.lastRunAt,
      lastResult: this.lastResult,
      lastErrorAt: this.lastErrorAt,
      lastError: this.lastError,
      intervalSeconds: this.config.mediaUploadCleanupIntervalSeconds,
    };
  }
}
