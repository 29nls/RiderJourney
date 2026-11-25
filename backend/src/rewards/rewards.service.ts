import { Inject, Injectable } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE, type Database } from '../db/database.js';

/** Closed set: speed, distance, and phone-in-hand are not representable here. */
const REASONS = [
  'safety_checklist', 'community_event_rsvp', 'effective_hazard_report', 'clean_comment', 'new_badge', 'redeem_bonus',
] as const;

type Reason = (typeof REASONS)[number];

type LedgerRow = {
  id: string;
  delta: number;
  reason: string;
  reference_type: string;
  reference_id: string;
  created_at: Date;
};

type BadgeRow = {
  code: string;
  title: string;
  description: string;
  criteria: Record<string, number>;
  for_safe_riding: boolean;
  awarded_at: Date | null;
};

const POINT_VALUES: Record<Reason, number> = {
  safety_checklist: 10,
  community_event_rsvp: 5,
  effective_hazard_report: 15,
  clean_comment: 1,
  new_badge: 5,
  redeem_bonus: 1,
};

function uuidFor(key: string): string {
  const hex = createHash('sha256').update(key).digest('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-5${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

@Injectable()
export class RewardsService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private async award(userId: string, reason: Reason, referenceType: string, referenceId: string): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO point_ledger (id, user_id, delta, reason, reference_type, reference_id)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (user_id, reason, reference_id) DO NOTHING
       RETURNING id`,
      [uuidv7(), userId, POINT_VALUES[reason], reason, referenceType, referenceId],
    );
    return rows.length > 0;
  }

  /** Admin-issued redeem reward. The redemption id is the immutable reference. */
  async awardRedeemBonus(userId: string, redemptionId: string, points: number): Promise<boolean> {
    const rows = await this.db.query<{ id: string }>(
      `INSERT INTO point_ledger (id, user_id, delta, reason, reference_type, reference_id)
       VALUES ($1, $2, $3, 'redeem_bonus', 'redeem', $4)
       ON CONFLICT (user_id, reason, reference_id) DO NOTHING RETURNING id`,
      [uuidv7(), userId, points, redemptionId],
    );
    return rows.length > 0;
  }

  async points(userId: string) {
    const rows = await this.db.query<LedgerRow>(
      `SELECT id, delta, reason, reference_type, reference_id, created_at
       FROM point_ledger WHERE user_id = $1 ORDER BY created_at DESC LIMIT 100`,
      [userId],
    );
    const totals = await this.db.query<{ reason: string; total: number }>(
      `SELECT reason, sum(delta)::int AS total FROM point_ledger WHERE user_id = $1 GROUP BY reason`,
      [userId],
    );
    return {
      total: totals.reduce((sum, row) => sum + Number(row.total), 0),
      byReason: Object.fromEntries(totals.map((row) => [row.reason, Number(row.total)])),
      entries: rows.map((row) => ({
        id: row.id,
        delta: row.delta,
        reason: row.reason,
        referenceType: row.reference_type,
        referenceId: row.reference_id,
        createdAt: new Date(row.created_at).toISOString(),
      })),
      policy: 'Poin hanya dari checklist keselamatan, kegiatan komunitas, laporan bahaya, komentar baik, dan badge. Tidak ada poin untuk kecepatan atau penggunaan ponsel saat berkendara.',
    };
  }

  /**
   * Pre-ride checklist. One award per user per UTC day; the deterministic
   * reference id makes retries idempotent without a separate table.
   */
  async safetyChecklist(userId: string) {
    const day = new Date().toISOString().slice(0, 10);
    const awarded = await this.award(userId, 'safety_checklist', 'trip', uuidFor(`checklist:${userId}:${day}`));
    const badges = await this.evaluateBadges(userId);
    return { date: day, awarded, points: POINT_VALUES.safety_checklist, badgesAwarded: badges.awarded };
  }

  async badges(userId: string) {
    const rows = await this.db.query<BadgeRow>(
      `SELECT b.code, b.title, b.description, b.criteria, b.for_safe_riding, ub.awarded_at
       FROM badges b LEFT JOIN user_badges ub ON ub.badge_code = b.code AND ub.user_id = $1
       ORDER BY b.code ASC`,
      [userId],
    );
    return {
      items: rows.map((row) => ({
        code: row.code,
        title: row.title,
        description: row.description,
        criteria: row.criteria,
        forSafeRiding: row.for_safe_riding,
        earned: row.awarded_at !== null,
        awardedAt: row.awarded_at ? new Date(row.awarded_at).toISOString() : null,
      })),
    };
  }

  async evaluateBadges(userId: string) {
    const counts = await this.db.query<{
      safety: string; hazards: string; rsvps: string; comments: string;
    }>(
      `SELECT
         (SELECT count(*) FROM point_ledger WHERE user_id = $1 AND reason = 'safety_checklist')::text AS safety,
         (SELECT count(*) FROM point_ledger WHERE user_id = $1 AND reason = 'effective_hazard_report')::text AS hazards,
         (SELECT count(*) FROM point_ledger WHERE user_id = $1 AND reason = 'community_event_rsvp')::text AS rsvps,
         (SELECT count(*) FROM comments c WHERE c.author_id = $1 AND c.deleted_at IS NULL
            AND NOT EXISTS (
              SELECT 1 FROM content_reports r
              WHERE r.target_type = 'comment' AND r.target_id = c.id AND r.status IN ('pending', 'reviewing', 'actioned')
            ))::text AS comments`,
      [userId],
    );
    const metrics: Record<string, number> = {
      safetyChecklists: Number(counts[0]?.safety ?? 0),
      effectiveHazardReports: Number(counts[0]?.hazards ?? 0),
      eventRsvps: Number(counts[0]?.rsvps ?? 0),
      cleanComments: Number(counts[0]?.comments ?? 0),
    };
    const badges = await this.db.query<BadgeRow>(`SELECT * FROM badges ORDER BY code ASC`);
    const awarded: string[] = [];
    for (const badge of badges) {
      const criteria = badge.criteria ?? {};
      const qualifies = Object.entries(criteria).every(([key, value]) => (metrics[key] ?? 0) >= Number(value));
      if (!qualifies) continue;
      const inserted = await this.db.query<{ badge_code: string }>(
        `INSERT INTO user_badges (user_id, badge_code) VALUES ($1, $2)
         ON CONFLICT DO NOTHING RETURNING badge_code`,
        [userId, badge.code],
      );
      if (inserted[0]) {
        awarded.push(badge.code);
        await this.award(userId, 'new_badge', 'badge', uuidFor(`badge:${badge.code}`));
      }
    }
    return { awarded, metrics };
  }

  async leaderboard(viewerId: string, limit = 50) {
    const rows = await this.db.query<{
      user_id: string; points: number; username: string; display_name: string; avatar_media_id: string | null;
    }>(
      `SELECT l.user_id, l.points::int AS points, u.username, u.display_name, rp.avatar_media_id
       FROM leaderboard_entries l
       JOIN users u ON u.id = l.user_id
       LEFT JOIN rider_profiles rp ON rp.user_id = l.user_id
       ORDER BY l.points DESC, l.user_id ASC LIMIT $1`,
      [limit],
    );
    const optIn = await this.db.query<{ leaderboard_opt_in: boolean }>(
      `SELECT leaderboard_opt_in FROM rider_profiles WHERE user_id = $1`,
      [viewerId],
    );
    const items = rows.map((row, index) => ({
      rank: index + 1,
      userId: row.user_id,
      username: row.username,
      displayName: row.display_name,
      avatarMediaId: row.avatar_media_id,
      points: Number(row.points),
    }));
    const mine = items.find((item) => item.userId === viewerId) ?? null;
    return {
      items,
      me: mine,
      optIn: optIn[0]?.leaderboard_opt_in ?? false,
      policy: 'Hanya akun yang memilih ikut serta dan hanya poin keselamatan/partisipasi yang dihitung. Kecepatan dan jarak tidak pernah masuk peringkat.',
    };
  }
}
