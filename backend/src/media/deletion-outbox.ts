import { Inject, Injectable } from '@nestjs/common';
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
    };
  }
}
