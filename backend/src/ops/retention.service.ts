import { Inject, Injectable } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.js';
import { PrivacyService } from './privacy.service.js';

@Injectable()
export class RetentionService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    private readonly privacy: PrivacyService,
  ) {}

  private async jobs() {
    const rows = await this.db.query<{ value: Record<string, unknown> }>(`SELECT value FROM admin_config WHERE key = 'retention'`);
    const value = rows[0]?.value ?? {};
    return {
      exportDays: Number(value.exportDays ?? this.config.exportTtlDays),
      deletionGraceDays: Number(value.deletionGraceDays ?? this.config.deletionGraceDays),
      notificationDays: Number(value.notificationDays ?? 180),
      billingEventDays: Number(value.billingEventDays ?? 365),
    };
  }

  async run() {
    const id = uuidv7();
    await this.db.query(`INSERT INTO job_runs (id, job_name, status) VALUES ($1, 'retention', 'running')`, [id]);
    try {
      const retention = await this.jobs();
      const exports = await this.privacy.runExportJobs(10, retention.exportDays);
      const deletions = await this.privacy.runDueDeletions();
      const expiredExports = await this.db.query(
        `UPDATE data_export_jobs SET status = 'expired', payload = NULL
         WHERE status = 'ready' AND expires_at IS NOT NULL AND expires_at <= now() RETURNING id`,
      );
      const notifications = await this.db.query(
        `DELETE FROM billing_notifications WHERE received_at < now() - ($1 || ' days')::interval RETURNING message_id`,
        [retention.notificationDays],
      );
      const events = await this.db.query(
        `DELETE FROM billing_events WHERE created_at < now() - ($1 || ' days')::interval RETURNING id`,
        [retention.billingEventDays],
      );
      const grants = await this.db.query(
        `DELETE FROM user_grants WHERE expires_at IS NOT NULL AND expires_at < now() - interval '30 days' RETURNING id`,
      );
      const detail = {
        exports,
        deletions,
        expiredExports: expiredExports.length,
        notificationsDeleted: notifications.length,
        billingEventsDeleted: events.length,
        expiredGrantsDeleted: grants.length,
      };
      await this.db.query(`UPDATE job_runs SET status = 'succeeded', detail = $2::jsonb, finished_at = now() WHERE id = $1`, [id, JSON.stringify(detail)]);
      return { jobRunId: id, ...detail };
    } catch (error) {
      await this.db.query(
        `UPDATE job_runs SET status = 'failed', detail = $2::jsonb, finished_at = now() WHERE id = $1`,
        [id, JSON.stringify({ error: error instanceof Error ? error.message : 'retention failed' })],
      );
      throw error;
    }
  }

  async runs(limit = 20) {
    const rows = await this.db.query(
      `SELECT id, job_name, status, detail, started_at, finished_at FROM job_runs ORDER BY started_at DESC LIMIT $1`,
      [limit],
    );
    return {
      items: rows.map((row: Record<string, unknown>) => ({
        id: row.id,
        job: row.job_name,
        status: row.status,
        detail: row.detail,
        startedAt: new Date(row.started_at as Date).toISOString(),
        finishedAt: row.finished_at ? new Date(row.finished_at as Date).toISOString() : null,
      })),
    };
  }
}
