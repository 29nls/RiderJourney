import { Inject, Injectable, Logger } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.js';
import { MediaDeletionWorker } from './deletion-outbox.js';
import { MediaScanWorker } from './scan-worker.js';
import { UploadCleanupService } from './upload-cleanup.js';

/**
 * Delivery is behind an interface on purpose: the project has no notification
 * provider configured, and inventing one would fake a capability. The no-op
 * notifier reports `available() === false`, so alerts are recorded and visible
 * to admins even when nothing is delivered externally.
 */
export interface AlertNotifier {
  readonly name: string;
  available(): boolean;
  send(event: { kind: string; severity: string; summary: string; details: Record<string, unknown> }): Promise<boolean>;
}

export class NoopAlertNotifier implements AlertNotifier {
  readonly name = 'none';
  available(): boolean {
    return false;
  }
  async send(): Promise<boolean> {
    return false;
  }
}

export const ALERT_NOTIFIER = Symbol('ALERT_NOTIFIER');

type Condition = {
  kind: string;
  severity: 'warning' | 'critical';
  summary: string;
  details: Record<string, unknown>;
};

type AlertRow = {
  id: string;
  kind: string;
  severity: string;
  status: string;
  occurrences: number;
  last_notified_at: Date | null;
};

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);
  private timer: ReturnType<typeof setInterval> | null = null;
  private running = false;
  private lastRunAt: Date | null = null;
  private lastResult: { active: number; opened: number; resolved: number; notified: number } | null = null;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(ALERT_NOTIFIER) private readonly notifier: AlertNotifier,
    private readonly deletion: MediaDeletionWorker,
    private readonly scanning: MediaScanWorker,
    private readonly cleanup: UploadCleanupService,
  ) {}

  /**
   * Collects the conditions worth waking an operator for. Thresholds come from
   * config so a deployment can tune them without touching code.
   */
  async conditions(): Promise<Condition[]> {
    const deletion = await this.deletion.health();
    const scan = await this.scanning.status();
    const uploads = this.cleanup.status();
    const conditions: Condition[] = [];

    if (deletion.status === 'unavailable') {
      conditions.push({
        kind: 'deletion_worker_unavailable',
        severity: 'critical',
        summary: 'Deletion worker is not scheduled; queued deletions will never run',
        details: { pending: deletion.pending },
      });
    }
    if (uploads.status === 'unavailable') {
      conditions.push({
        kind: 'upload_cleanup_unavailable',
        severity: 'warning',
        summary: 'Upload cleanup is not scheduled; expired intents will accumulate',
        details: {},
      });
    }
    if (deletion.failed > 0) {
      conditions.push({
        kind: 'deletion_dead_letter',
        severity: 'critical',
        summary: 'Deletion jobs reached the dead-letter state',
        details: { failed: deletion.failed, lastError: deletion.lastError },
      });
    }
    if (deletion.oldestPendingSeconds !== null && deletion.oldestPendingSeconds > this.config.alertBacklogSeconds) {
      conditions.push({
        kind: 'deletion_backlog',
        severity: 'warning',
        summary: 'Oldest pending deletion job passed the backlog threshold',
        details: { oldestPendingSeconds: deletion.oldestPendingSeconds, threshold: this.config.alertBacklogSeconds },
      });
    }
    if (scan.unscanned > this.config.alertScanBacklog) {
      conditions.push({
        kind: 'scan_backlog',
        severity: 'warning',
        summary: 'Media scan queue backlog above threshold',
        details: { unscanned: scan.unscanned, threshold: this.config.alertScanBacklog },
      });
    }
    if (!scan.available) {
      conditions.push({
        kind: 'scanner_unavailable',
        severity: 'warning',
        summary: 'No scanner is configured; media stays unscanned and cannot be shown publicly',
        details: { provider: scan.provider },
      });
    }
    if (scan.failed > 0) {
      conditions.push({
        kind: 'scan_failures',
        severity: 'warning',
        summary: 'Media scans exhausted their retries',
        details: { failed: scan.failed },
      });
    }
    return conditions;
  }

  /**
   * Upserts active conditions, resolves the ones that cleared, and notifies at
   * most once per cooldown window. One row per kind is what makes a repeated
   * condition bump `occurrences` instead of spamming a new alert.
   */
  async evaluate() {
    const conditions = await this.conditions();
    const cooldownMs = this.config.alertCooldownSeconds * 1000;
    const now = Date.now();
    let opened = 0;
    let notified = 0;

    for (const condition of conditions) {
      const rows = await this.db.query<AlertRow>(
        `INSERT INTO ops_alert_events (id, kind, severity, summary, details)
         VALUES ($1, $2, $3, $4, $5::jsonb)
         ON CONFLICT (kind) DO UPDATE SET
           severity = EXCLUDED.severity,
           summary = EXCLUDED.summary,
           details = EXCLUDED.details,
           occurrences = ops_alert_events.occurrences + 1,
           last_seen_at = now(),
           status = 'active',
           resolved_at = NULL
         RETURNING id, kind, severity, status, occurrences, last_notified_at`,
        [uuidv7(), condition.kind, condition.severity, condition.summary, JSON.stringify(condition.details)],
      );
      const alert = rows[0]!;
      if (alert.occurrences === 1) opened += 1;

      const lastNotified = alert.last_notified_at ? new Date(alert.last_notified_at).getTime() : 0;
      if (this.notifier.available() && now - lastNotified >= cooldownMs) {
        const delivered = await this.notifier.send({
          kind: condition.kind,
          severity: condition.severity,
          summary: condition.summary,
          details: condition.details,
        });
        if (delivered) {
          notified += 1;
          await this.db.query(`UPDATE ops_alert_events SET last_notified_at = now() WHERE id = $1`, [alert.id]);
        }
      }
    }

    const kinds = conditions.map((c) => c.kind);
    const resolved = await this.db.query<{ id: string; kind: string }>(
      `UPDATE ops_alert_events SET status = 'resolved', resolved_at = now()
       WHERE status = 'active' AND NOT (kind = ANY($1::text[]))
       RETURNING id, kind`,
      [kinds],
    );
    for (const row of resolved) {
      // Recovery is recorded even when delivery is unavailable, so the admin
      // page shows the condition cleared and when.
      if (this.notifier.available()) {
        await this.notifier.send({
          kind: row.kind,
          severity: 'warning',
          summary: `Recovered: ${row.kind}`,
          details: { recovered: true },
        });
      }
    }

    this.lastRunAt = new Date();
    this.lastResult = { active: conditions.length, opened, resolved: resolved.length, notified };
    return { ...this.lastResult, notifier: { name: this.notifier.name, available: this.notifier.available() } };
  }

  /** Active and recently resolved alerts for the admin page. */
  async list(params: { status?: string; limit?: number } = {}) {
    const limit = Math.min(Math.max(params.limit ?? 20, 1), 100);
    const values: unknown[] = [];
    let where = `status = 'active'`;
    if (params.status === 'resolved') where = `status = 'resolved'`;
    else if (params.status === 'all') where = `TRUE`;
    values.push(limit);
    const rows = await this.db.query<{
      id: string;
      kind: string;
      severity: string;
      status: string;
      summary: string;
      details: Record<string, unknown>;
      occurrences: number;
      first_seen_at: Date;
      last_seen_at: Date;
      last_notified_at: Date | null;
      resolved_at: Date | null;
    }>(
      `SELECT id, kind, severity, status, summary, details, occurrences,
              first_seen_at, last_seen_at, last_notified_at, resolved_at
       FROM ops_alert_events WHERE ${where}
       ORDER BY last_seen_at DESC LIMIT $${values.length}`,
      values,
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        severity: row.severity,
        status: row.status,
        summary: row.summary,
        details: row.details,
        occurrences: row.occurrences,
        firstSeenAt: new Date(row.first_seen_at).toISOString(),
        lastSeenAt: new Date(row.last_seen_at).toISOString(),
        lastNotifiedAt: row.last_notified_at ? new Date(row.last_notified_at).toISOString() : null,
        resolvedAt: row.resolved_at ? new Date(row.resolved_at).toISOString() : null,
      })),
      notifier: { name: this.notifier.name, available: this.notifier.available() },
    };
  }

  startScheduled(intervalSeconds = this.config.alertPollSeconds) {
    if (this.timer) return;
    const run = async () => {
      if (this.running) return;
      this.running = true;
      try {
        const result = await this.evaluate();
        if (result.opened > 0) this.logger.warn(`Opened ${result.opened} storage alert(s)`);
      } catch (error) {
        this.logger.error('Alert evaluation failed', error instanceof Error ? error.message : String(error));
      } finally {
        this.running = false;
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

  status() {
    return {
      scheduled: this.timer !== null,
      lastRunAt: this.lastRunAt,
      lastResult: this.lastResult,
      notifier: { name: this.notifier.name, available: this.notifier.available() },
      pollSeconds: this.config.alertPollSeconds,
      cooldownSeconds: this.config.alertCooldownSeconds,
    };
  }
}
