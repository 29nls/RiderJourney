import { Inject, Injectable, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.js';
import { OBJECT_STORAGE, type ObjectStorage } from './object-storage.js';

/**
 * Must be called inside the same transaction that removes media metadata.
 * A committed database change with no outbox row would leave bytes behind with
 * nothing left to point at them.
 */
export async function enqueueMediaDeletion(tx: Database, objectKeys: string[], reason: string): Promise<number> {
  let enqueued = 0;
  for (const objectKey of objectKeys) {
    const rows = await tx.query<{ id: string }>(
      `INSERT INTO media_deletion_outbox (id, object_key, reason)
       VALUES ($1, $2, $3)
       ON CONFLICT (object_key) DO NOTHING
       RETURNING id`,
      [uuidv7(), objectKey, reason],
    );
    enqueued += rows.length;
  }
  return enqueued;
}

type OutboxRow = {
  id: string;
  object_key: string;
  attempts: number;
};

@Injectable()
export class MediaDeletionWorker {
  private readonly logger = new Logger(MediaDeletionWorker.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private stopping = false;
  private lastRunAt: Date | null = null;
  private lastResult: { processed: number; succeeded: number; retrying: number; deadLettered: number } | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(OBJECT_STORAGE) private readonly storage: ObjectStorage,
  ) {}

  /**
   * Claims due rows with SKIP LOCKED so two workers never delete the same job.
   * A process that dies mid-delete leaves the row in `processing`; after ten
   * minutes it becomes claimable again.
   */
  async processBatch(limit = 20) {
    let succeeded = 0;
    let retrying = 0;
    let deadLettered = 0;
    for (let i = 0; i < limit; i += 1) {
      const rows = await this.db.query<OutboxRow>(
        `UPDATE media_deletion_outbox AS o
         SET status = 'processing', attempts = o.attempts + 1, updated_at = now()
         WHERE o.id = (
           SELECT id FROM media_deletion_outbox
           WHERE (status = 'pending' AND next_attempt_at <= now())
              OR (status = 'processing' AND updated_at < now() - interval '10 minutes')
           ORDER BY next_attempt_at ASC, created_at ASC
           FOR UPDATE SKIP LOCKED
           LIMIT 1
         )
         RETURNING o.id, o.object_key, o.attempts`,
      );
      const job = rows[0];
      if (!job) break;
      try {
        await this.storage.delete(job.object_key);
        const remaining = await this.storage.head(job.object_key);
        if (remaining) throw new Error('object still present after delete');
        await this.db.query(
          `UPDATE media_deletion_outbox
           SET status = 'done', completed_at = now(), updated_at = now(), last_error = NULL
           WHERE id = $1`,
          [job.id],
        );
        // Only now, with the object proven gone, does the metadata row leave
        // 'deleting' and stop counting against the owner's quota.
        await this.db.query(
          `UPDATE media_assets SET status = 'deleted', deletion_requested_at = NULL
           WHERE object_key = $1 AND status = 'deleting'`,
          [job.object_key],
        );
        succeeded += 1;
      } catch (error) {
        const message = (error instanceof Error ? error.message : String(error)).slice(0, 300);
        if (job.attempts >= this.config.mediaDeletionMaxAttempts) {
          await this.db.query(
            `UPDATE media_deletion_outbox SET status = 'failed', last_error = $2, updated_at = now() WHERE id = $1`,
            [job.id, message],
          );
          deadLettered += 1;
        } else {
          const delay = Math.min(this.config.mediaDeletionBackoffSeconds * 2 ** (job.attempts - 1), 3600);
          await this.db.query(
            `UPDATE media_deletion_outbox
             SET status = 'pending', next_attempt_at = now() + ($2 || ' seconds')::interval,
                 last_error = $3, updated_at = now()
             WHERE id = $1`,
            [job.id, delay, message],
          );
          retrying += 1;
        }
      }
    }
    return { processed: succeeded + retrying + deadLettered, succeeded, retrying, deadLettered };
  }

  /** Counts for operators; failed rows are the dead-letter queue. */
  async status() {
    const rows = await this.db.query<{ status: string; count: number; next_attempt_at: Date | null }>(
      `SELECT status, count(*)::int AS count, min(next_attempt_at) AS next_attempt_at
       FROM media_deletion_outbox GROUP BY status`,
    );
    return {
      pending: rows.find((r) => r.status === 'pending')?.count ?? 0,
      processing: rows.find((r) => r.status === 'processing')?.count ?? 0,
      done: rows.find((r) => r.status === 'done')?.count ?? 0,
      failed: rows.find((r) => r.status === 'failed')?.count ?? 0,
      nextAttemptAt: rows.find((r) => r.status === 'pending')?.next_attempt_at ?? null,
      scheduled: this.timer !== null,
      running: this.running,
      lastRunAt: this.lastRunAt,
      lastResult: this.lastResult,
    };
  }

  /**
   * Recovers media rows stuck in 'deleting' with no live job behind them — the
   * case where a worker died, or a job was lost. HEAD decides the outcome: if
   * bytes are still stored, the job is requeued; only when storage proves the
   * object is gone does the row become 'deleted'. A row is never returned to
   * 'ready', because that would resurrect content its owner asked to remove.
   */
  async reconcileStale(olderThanSeconds = this.config.mediaDeletionStaleSeconds, limit = 50) {
    const rows = await this.db.query<{ id: string; object_key: string; owner_id: string }>(
      `SELECT m.id, m.object_key, m.owner_id
       FROM media_assets m
       WHERE m.status = 'deleting'
         AND m.deletion_requested_at < now() - ($1 || ' seconds')::interval
         AND NOT EXISTS (
           SELECT 1 FROM media_deletion_outbox o
           WHERE o.object_key = m.object_key AND o.status IN ('pending', 'processing')
         )
       ORDER BY m.deletion_requested_at ASC
       LIMIT $2`,
      [olderThanSeconds, limit],
    );

    let requeued = 0;
    let completed = 0;
    let deferred = 0;
    for (const row of rows) {
      let exists: boolean;
      try {
        exists = (await this.storage.head(row.object_key)) !== null;
      } catch {
        // Storage unreachable: leave the row alone so the next pass retries.
        deferred += 1;
        continue;
      }

      if (exists) {
        await this.db.transaction(async (tx) => {
          // A dead-lettered job for the same object is reset rather than
          // duplicated: UNIQUE(object_key) means one job per object for life.
          const existing = await tx.query<{ id: string }>(
            `SELECT id FROM media_deletion_outbox WHERE object_key = $1`,
            [row.object_key],
          );
          let jobId = existing[0]?.id;
          if (jobId) {
            await tx.query(
              `UPDATE media_deletion_outbox
               SET status = 'pending', attempts = 0, next_attempt_at = now(),
                   last_error = NULL, updated_at = now()
               WHERE id = $1`,
              [jobId],
            );
          } else {
            await enqueueMediaDeletion(tx, [row.object_key], 'recovery_requeue');
            const created = await tx.query<{ id: string }>(
              `SELECT id FROM media_deletion_outbox WHERE object_key = $1`,
              [row.object_key],
            );
            jobId = created[0]?.id;
          }
          if (jobId) {
            await tx.query(
              `INSERT INTO media_deletion_ops_log (id, outbox_id, actor_id, action, note)
               VALUES ($1, $2, NULL, 'reconcile', $3)`,
              [uuidv7(), jobId, 'stale deleting row with object still present'],
            );
          }
        });
        requeued += 1;
      } else {
        await this.db.query(
          `UPDATE media_assets SET status = 'deleted', deletion_requested_at = NULL
           WHERE id = $1 AND status = 'deleting'`,
          [row.id],
        );
        completed += 1;
      }
    }
    return { scanned: rows.length, requeued, completed, deferred };
  }

  /** Dead-letter listing for operators. Object keys stay out of the response. */
  async failedJobs(limit = 20) {
    const rows = await this.db.query<{
      id: string;
      reason: string;
      attempts: number;
      last_error: string | null;
      created_at: Date;
      updated_at: Date;
    }>(
      `SELECT id, reason, attempts, last_error, created_at, updated_at
       FROM media_deletion_outbox WHERE status = 'failed'
       ORDER BY updated_at DESC LIMIT $1`,
      [Math.min(Math.max(limit, 1), 100)],
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        reason: row.reason,
        attempts: row.attempts,
        lastError: row.last_error,
        createdAt: new Date(row.created_at).toISOString(),
        updatedAt: new Date(row.updated_at).toISOString(),
      })),
    };
  }

  /**
   * Operator retry of one dead-lettered job. History is kept: the previous
   * error is copied into the ops log before the row is reset.
   */
  async retryDeadLetter(actorId: string, outboxId: string, note?: string) {
    return this.db.transaction(async (tx) => {
      const rows = await tx.query<{ id: string; last_error: string | null }>(
        `UPDATE media_deletion_outbox
         SET status = 'pending', attempts = 0, next_attempt_at = now(),
             last_error = NULL, updated_at = now()
         WHERE id = $1 AND status = 'failed'
         RETURNING id, last_error`,
        [outboxId],
      );
      if (!rows[0]) return null;
      await tx.query(
        `INSERT INTO media_deletion_ops_log (id, outbox_id, actor_id, action, note)
         VALUES ($1, $2, $3, 'requeue', $4)`,
        [uuidv7(), outboxId, actorId, note ?? 'operator retry of dead-lettered job'],
      );
      return { id: outboxId, status: 'pending' };
    });
  }

  /**
   * Operator-facing health: queue depth, oldest waiting job, last success and
   * failure, and a single status word. No object keys, URLs, or user data.
   */
  async health() {
    const rows = await this.db.query<{
      pending: number;
      processing: number;
      done: number;
      failed: number;
      oldest_pending_seconds: number | null;
      last_success_at: Date | null;
      last_failure_at: Date | null;
      last_error: string | null;
    }>(
      `SELECT
         count(*) FILTER (WHERE status = 'pending')::int AS pending,
         count(*) FILTER (WHERE status = 'processing')::int AS processing,
         count(*) FILTER (WHERE status = 'done')::int AS done,
         count(*) FILTER (WHERE status = 'failed')::int AS failed,
         extract(epoch FROM (now() - min(created_at) FILTER (WHERE status = 'pending')))::bigint AS oldest_pending_seconds,
         max(completed_at) FILTER (WHERE status = 'done') AS last_success_at,
         max(updated_at) FILTER (WHERE status = 'failed') AS last_failure_at,
         (SELECT last_error FROM media_deletion_outbox WHERE status = 'failed'
           ORDER BY updated_at DESC LIMIT 1) AS last_error
       FROM media_deletion_outbox`,
    );
    const r = rows[0]!;
    const oldest = r.oldest_pending_seconds === null ? null : Number(r.oldest_pending_seconds);

    // 'unavailable' means nobody is polling: a backlog in that state never
    // clears on its own, which is a different problem from a slow queue.
    let state: 'healthy' | 'degraded' | 'unavailable' = 'healthy';
    let reason = 'queue is draining';
    if (this.timer === null) {
      state = 'unavailable';
      reason = 'scheduler is not running';
    } else if (r.failed > 0) {
      state = 'degraded';
      reason = `${r.failed} dead-lettered job(s) need attention`;
    } else if (oldest !== null && oldest > 600) {
      state = 'degraded';
      reason = 'oldest pending job is over 10 minutes old';
    }

    return {
      status: state,
      reason,
      pending: r.pending,
      processing: r.processing,
      done: r.done,
      failed: r.failed,
      oldestPendingSeconds: oldest,
      lastSuccessAt: r.last_success_at,
      lastFailureAt: r.last_failure_at,
      lastError: r.last_error,
      scheduled: this.timer !== null,
      running: this.running,
      lastRunAt: this.lastRunAt,
      lastResult: this.lastResult,
    };
  }

  /** Start periodic execution. Safe to call multiple times. */
  startScheduled(pollSeconds = this.config.mediaDeletionPollSeconds, batchSize = this.config.mediaDeletionBatchSize) {
    if (this.timer) return;
    this.stopping = false;
    const run = async () => {
      if (this.running || this.stopping) return;
      this.running = true;
      try {
        this.lastResult = await this.processBatch(batchSize);
        this.lastRunAt = new Date();
        if (this.lastResult.deadLettered > 0) {
          this.logger.warn(`Dead-lettered ${this.lastResult.deadLettered} deletion(s)`);
        }
      } catch (error) {
        this.logger.error('Deletion worker error', error instanceof Error ? error.message : error);
      } finally {
        this.running = false;
      }
    };
    this.timer = setInterval(run, pollSeconds * 1000);
    // Also run once immediately after start.
    void run();
    this.logger.log(`Scheduled every ${pollSeconds}s, batch ${batchSize}`);
  }

  /** Graceful shutdown: finish current batch, then stop. */
  async stopScheduled() {
    this.stopping = true;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    // Wait for current batch to finish (up to 30s).
    for (let i = 0; i < 300 && this.running; i++) {
      await new Promise((r) => setTimeout(r, 100));
    }
    this.stopping = false;
  }
}
