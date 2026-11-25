import { ConflictException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.js';

type ExportRow = {
  id: string;
  user_id: string;
  status: string;
  payload: Record<string, unknown> | null;
  error: string | null;
  requested_at: Date;
  completed_at: Date | null;
  expires_at: Date | null;
};

type DeletionRow = {
  id: string;
  user_id: string;
  status: string;
  reason: string | null;
  requested_at: Date;
  execute_after: Date;
  completed_at: Date | null;
};

@Injectable()
export class PrivacyService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async requestExport(userId: string) {
    const open = await this.db.query<{ id: string }>(
      `SELECT id FROM data_export_jobs WHERE user_id = $1 AND status IN ('queued', 'ready')
       AND (expires_at IS NULL OR expires_at > now()) ORDER BY requested_at DESC LIMIT 1`,
      [userId],
    );
    if (open[0]) return { id: open[0].id, status: 'ready_or_queued', duplicate: true };
    const id = uuidv7();
    await this.db.query(`INSERT INTO data_export_jobs (id, user_id) VALUES ($1, $2)`, [id, userId]);
    return { id, status: 'queued', duplicate: false };
  }

  async exportJobs(userId: string) {
    const rows = await this.db.query<ExportRow>(
      `SELECT id, user_id, status, NULL::jsonb AS payload, error, requested_at, completed_at, expires_at
       FROM data_export_jobs WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 20`,
      [userId],
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        status: row.status,
        error: row.error,
        requestedAt: new Date(row.requested_at).toISOString(),
        completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
        expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      })),
    };
  }

  async download(userId: string, id: string) {
    const rows = await this.db.query<ExportRow>(
      `SELECT * FROM data_export_jobs WHERE id = $1 AND user_id = $2`,
      [id, userId],
    );
    const job = rows[0];
    if (!job) throw new NotFoundException({ code: 'EXPORT_NOT_FOUND', title: 'Ekspor tidak ditemukan', detail: 'ID tidak ada.' });
    if (job.status !== 'ready' || !job.payload) {
      throw new ConflictException({ code: 'EXPORT_NOT_READY', title: 'Ekspor belum siap', detail: `Status: ${job.status}.` });
    }
    if (job.expires_at && new Date(job.expires_at).getTime() <= Date.now()) {
      await this.db.query(`UPDATE data_export_jobs SET status = 'expired', payload = NULL WHERE id = $1`, [id]);
      throw new ConflictException({ code: 'EXPORT_EXPIRED', title: 'Ekspor kedaluwarsa', detail: 'Minta ekspor baru.' });
    }
    return job.payload;
  }

  private async retentionSettings(): Promise<Record<string, number>> {
    const rows = await this.db.query<{ value: Record<string, unknown> }>(`SELECT value FROM admin_config WHERE key = 'retention'`);
    const value = rows[0]?.value ?? {};
    return {
      exportDays: Number(value.exportDays ?? this.config.exportTtlDays),
      deletionGraceDays: Number(value.deletionGraceDays ?? this.config.deletionGraceDays),
    };
  }

  async requestDeletion(userId: string, confirmation: string, reason?: string) {
    if (confirmation.trim().toUpperCase() !== 'HAPUS AKUN') {
      throw new ConflictException({ code: 'DELETION_CONFIRMATION_REQUIRED', title: 'Konfirmasi tidak cocok', detail: 'Tulis HAPUS AKUN untuk melanjutkan.' });
    }
    const open = await this.db.query<{ id: string }>(
      `SELECT id FROM data_deletion_requests WHERE user_id = $1 AND status = 'scheduled'`,
      [userId],
    );
    if (open[0]) return { id: open[0].id, status: 'scheduled', duplicate: true };
    const id = uuidv7();
    const retention = await this.retentionSettings();
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO data_deletion_requests (id, user_id, reason, execute_after)
         VALUES ($1, $2, $3, now() + ($4 || ' days')::interval)`,
        [id, userId, reason ?? null, retention.deletionGraceDays],
      );
      await tx.query(`UPDATE users SET status = 'deletion_pending', updated_at = now() WHERE id = $1`, [userId]);
      await tx.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
    });
    return {
      id,
      status: 'scheduled',
      executeAfter: new Date(Date.now() + retention.deletionGraceDays * 86_400_000).toISOString(),
    };
  }

  async deletionStatus(userId: string) {
    const rows = await this.db.query<DeletionRow>(
      `SELECT id, status, reason, requested_at, execute_after, completed_at
       FROM data_deletion_requests WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 1`,
      [userId],
    );
    const row = rows[0];
    return {
      request: row ? {
        id: row.id,
        status: row.status,
        reason: row.reason,
        requestedAt: new Date(row.requested_at).toISOString(),
        executeAfter: new Date(row.execute_after).toISOString(),
        completedAt: row.completed_at ? new Date(row.completed_at).toISOString() : null,
      } : null,
    };
  }

  async cancelDeletion(userId: string, id: string) {
    const rows = await this.db.query<{ id: string }>(
      `SELECT id FROM data_deletion_requests WHERE id = $1 AND user_id = $2 AND status = 'scheduled'`,
      [id, userId],
    );
    if (!rows[0]) throw new NotFoundException({ code: 'DELETION_NOT_FOUND', title: 'Permintaan tidak ditemukan', detail: 'Tidak ada permintaan aktif.' });
    await this.db.transaction(async (tx) => {
      await tx.query(`UPDATE data_deletion_requests SET status = 'cancelled' WHERE id = $1`, [id]);
      await tx.query(`UPDATE users SET status = 'active', updated_at = now() WHERE id = $1`, [userId]);
    });
    return { id, status: 'cancelled' };
  }

  private async exportPayload(userId: string): Promise<Record<string, unknown>> {
    const tables: Array<[string, string]> = [
      ['profile', `SELECT id, email, username, display_name, bio, city, avatar_url, visibility, status, email_verified, created_at FROM users WHERE id = $1`],
      ['vehicles', `SELECT id, type, brand, model, year, nickname, is_primary, created_at FROM vehicles WHERE owner_id = $1 AND deleted_at IS NULL LIMIT 2000`],
      ['trips', `SELECT id, status, started_at, ended_at, distance_m, duration_s, created_at FROM trips WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5000`],
      ['posts', `SELECT id, kind, audience, caption, status, created_at FROM posts WHERE author_id = $1 AND deleted_at IS NULL LIMIT 5000`],
      ['albums', `SELECT id, title, description, visibility, quota_bytes, used_bytes, created_at FROM albums WHERE owner_id = $1 LIMIT 2000`],
      ['media', `SELECT id, purpose, mime_type, size_bytes, status, created_at FROM media_assets WHERE owner_id = $1 LIMIT 5000`],
      ['points', `SELECT delta, reason, reference_type, reference_id, created_at FROM point_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 5000`],
      ['subscriptions', `SELECT plan_code, provider, status, started_at, expires_at, grace_until FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`],
      ['redemptions', `SELECT reward_kind, reward_value, created_at FROM redeem_redemptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 1000`],
      ['reports_made', `SELECT target_type, reason, status, created_at FROM content_reports WHERE reporter_id = $1 LIMIT 1000`],
      ['community_memberships', `SELECT community_id, role, joined_at FROM community_members WHERE user_id = $1 LIMIT 1000`],
      ['grants', `SELECT kind, value, source, expires_at, created_at FROM user_grants WHERE user_id = $1 LIMIT 1000`],
    ];
    const output: Record<string, unknown> = {
      exportedAt: new Date().toISOString(),
      userId,
      note: 'Data teknis dan catatan keamanan/keuangan yang wajib disimpan tidak termasuk.',
    };
    for (const [key, sql] of tables) {
      try {
        output[key] = await this.db.query(sql, [userId]);
      } catch {
        output[key] = [];
      }
    }
    return output;
  }

  async runExportJobs(limit = 10, exportDays = this.config.exportTtlDays) {
    const rows = await this.db.query<{ id: string; user_id: string }>(
      `SELECT id, user_id FROM data_export_jobs WHERE status = 'queued' ORDER BY requested_at ASC LIMIT $1`,
      [limit],
    );
    let completed = 0;
    let failed = 0;
    for (const job of rows) {
      try {
        const payload = await this.exportPayload(job.user_id);
        await this.db.query(
          `UPDATE data_export_jobs SET status = 'ready', payload = $2::jsonb, completed_at = now(),
             expires_at = now() + ($3 || ' days')::interval WHERE id = $1`,
          [job.id, JSON.stringify(payload), exportDays],
        );
        completed += 1;
      } catch (error) {
        failed += 1;
        await this.db.query(
          `UPDATE data_export_jobs SET status = 'failed', error = $2, completed_at = now() WHERE id = $1`,
          [job.id, (error instanceof Error ? error.message : 'export failed').slice(0, 300)],
        );
      }
    }
    return { candidates: rows.length, completed, failed };
  }

  /**
   * PII is scrubbed and user content is deleted. A pseudonymous user row is kept
   * because billing/audit records must survive for accounting and legal duties;
   * the response documents that exception.
   */
  async runDueDeletions(limit = 10) {
    const rows = await this.db.query<DeletionRow>(
      `SELECT * FROM data_deletion_requests WHERE status = 'scheduled' AND execute_after <= now()
       ORDER BY execute_after ASC LIMIT $1`,
      [limit],
    );
    let completed = 0;
    let failed = 0;
    for (const request of rows) {
      try {
        await this.db.transaction(async (tx) => {
          const owned = await tx.query<{ id: string }>(`SELECT id FROM communities WHERE owner_id = $1`, [request.user_id]);
          for (const community of owned) {
            await tx.query(`DELETE FROM communities WHERE id = $1`, [community.id]);
          }
          await tx.query(`DELETE FROM convoys WHERE leader_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM community_events WHERE created_by = $1`, [request.user_id]);
          await tx.query(`DELETE FROM posts WHERE author_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM comments WHERE author_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM albums WHERE owner_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM trips WHERE user_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM media_assets WHERE owner_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM vehicles WHERE owner_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM user_grants WHERE user_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM user_entitlements WHERE user_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM rider_profiles WHERE user_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM user_settings WHERE user_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM follows WHERE follower_id = $1 OR followee_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM follow_requests WHERE requester_id = $1 OR target_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM user_blocks WHERE blocker_id = $1 OR blocked_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM user_mutes WHERE muter_id = $1 OR muted_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM reactions WHERE user_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM comment_reactions WHERE user_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM post_saves WHERE user_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM trip_reactions WHERE user_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM notifications WHERE user_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM push_devices WHERE user_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM user_badges WHERE user_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM community_members WHERE user_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM community_event_rsvps WHERE user_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM convoy_members WHERE user_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM admin_users WHERE user_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM refresh_tokens WHERE user_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM one_time_tokens WHERE user_id = $1`, [request.user_id]);
          await tx.query(`DELETE FROM data_export_jobs WHERE user_id = $1`, [request.user_id]);
          await tx.query(
            `UPDATE users SET email = $2, username = $3, display_name = 'Akun dihapus', bio = NULL,
               city = NULL, avatar_url = NULL, password_hash = NULL, status = 'deleted', updated_at = now()
             WHERE id = $1`,
            [request.user_id, `deleted+${request.user_id}@invalid`, `deleted_${request.user_id.slice(0, 8)}`],
          );
          await tx.query(
            `UPDATE data_deletion_requests SET status = 'completed', completed_at = now() WHERE id = $1`,
            [request.id],
          );
        });
        completed += 1;
      } catch {
        failed += 1;
      }
    }
    return { candidates: rows.length, completed, failed };
  }
}
