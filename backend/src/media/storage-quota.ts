import { ConflictException, Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.js';

/**
 * Used bytes are always derived from `media_assets`, so a deletion releases
 * space without a second bookkeeping write that could drift. Only the
 * *reservation* is stored, because in-flight uploads have no size the server
 * can trust yet — their intent size is held instead.
 *
 * Accounting states:
 *   pending upload   → reserved_bytes (intent size, not trusted as ready)
 *   ready            → used_bytes (bytes are in storage and readable)
 *   deleting         → used_bytes (bytes are still in storage; a deletion
 *                      request alone must not free quota)
 *   expired/rejected → neither (cleanup releases the reservation)
 *   deleted          → neither (worker confirmed the object is gone)
 *
 * Forgetting the 'deleting' term would make the quota lie for as long as the
 * worker takes, so every query below uses the same STORED_STATUSES list.
 */
const STORED_STATUSES = `('ready', 'deleting')`;
@Injectable()
export class StorageQuotaService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  private async ensureQuota(userId: string): Promise<void> {
    await this.db.query(
      `INSERT INTO storage_quotas (user_id, quota_bytes) VALUES ($1, $2)
       ON CONFLICT (user_id) DO NOTHING`,
      [userId, this.config.mediaQuotaBytesDefault],
    );
  }

  async getQuota(userId: string) {
    await this.ensureQuota(userId);
    const rows = await this.db.query<{
      quota_bytes: number;
      used_bytes: number;
      ready_bytes: number;
      deleting_bytes: number;
      reserved_bytes: number;
    }>(
      `SELECT q.quota_bytes, q.reserved_bytes,
              COALESCE((SELECT SUM(m.size_bytes) FROM media_assets m
                        WHERE m.owner_id = q.user_id AND m.status IN ${STORED_STATUSES}), 0)::bigint AS used_bytes,
              COALESCE((SELECT SUM(m.size_bytes) FROM media_assets m
                        WHERE m.owner_id = q.user_id AND m.status = 'ready'), 0)::bigint AS ready_bytes,
              COALESCE((SELECT SUM(m.size_bytes) FROM media_assets m
                        WHERE m.owner_id = q.user_id AND m.status = 'deleting'), 0)::bigint AS deleting_bytes
       FROM storage_quotas q WHERE q.user_id = $1`,
      [userId],
    );
    const q = rows[0]!;
    return {
      quotaBytes: q.quota_bytes,
      usedBytes: q.used_bytes,
      readyBytes: q.ready_bytes,
      deletionPendingBytes: q.deleting_bytes,
      reservedBytes: q.reserved_bytes,
      availableBytes: Math.max(0, q.quota_bytes - q.used_bytes - q.reserved_bytes),
    };
  }

  /**
   * Reserve space for an upcoming upload. The CAS keeps concurrent intents
   * from together exceeding the quota: only a request whose total still fits
   * updates the row, the others see zero rows and are rejected.
   */
  async reserveUpload(userId: string, sizeBytes: number): Promise<void> {
    await this.ensureQuota(userId);
    const updated = await this.db.query<{ user_id: string }>(
      `UPDATE storage_quotas q
       SET reserved_bytes = q.reserved_bytes + $2, updated_at = now()
       WHERE q.user_id = $1
         AND (COALESCE((SELECT SUM(m.size_bytes) FROM media_assets m
                        WHERE m.owner_id = q.user_id AND m.status IN ${STORED_STATUSES}), 0)
              + q.reserved_bytes + $2) <= q.quota_bytes
       RETURNING q.user_id`,
      [userId, sizeBytes],
    );
    if (!updated[0]) {
      throw new ConflictException({
        code: 'STORAGE_QUOTA_EXCEEDED',
        title: 'Kuota penyimpanan penuh',
        detail: 'Hapus media lama untuk membuat ruang unggahan baru.',
      });
    }
  }

  /** Convert the reservation after completion; used space is derived on read. */
  async commitUpload(userId: string, sizeBytes: number): Promise<void> {
    await this.releaseReservation(userId, sizeBytes);
  }

  /** Release reservation when upload fails, expires, or completes. */
  async releaseReservation(userId: string, sizeBytes: number): Promise<void> {
    await this.db.query(
      `UPDATE storage_quotas
       SET reserved_bytes = GREATEST(0, reserved_bytes - $2), updated_at = now()
       WHERE user_id = $1`,
      [userId, sizeBytes],
    );
  }

  /** Recalculate the reservation from pending intents; used space is derived. */
  async reconcile(userId: string) {
    await this.ensureQuota(userId);
    await this.db.query(
      `UPDATE storage_quotas q
       SET reserved_bytes = COALESCE((SELECT SUM(m.size_bytes) FROM media_assets m
                                      WHERE m.owner_id = q.user_id AND m.status = 'pending'), 0),
           updated_at = now()
       WHERE q.user_id = $1`,
      [userId],
    );
    return this.getQuota(userId);
  }
}
