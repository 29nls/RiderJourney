import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.js';

export type PlanLimits = {
  planCode: string;
  source: 'free' | 'subscription' | 'grant' | 'override';
  status: string;
  expiresAt: string | null;
  convoyCapacity: number;
  albumQuotaBytes: number;
  vehicleLimit: number;
  posterTemplates: string[];
  features: Record<string, unknown>;
};

type PlanRow = {
  code: string;
  limits: Record<string, unknown>;
  features: Record<string, unknown>;
  grace_days: number;
};

type SubscriptionRow = {
  plan_code: string;
  status: string;
  expires_at: Date | null;
  grace_until: Date | null;
};

function numberLimit(value: unknown, fallback: number): number {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : fallback;
}

@Injectable()
export class PlanService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(APP_CONFIG) private readonly config: AppConfig,
  ) {}

  /** Paid plans need both the deployment switch and the admin config switch. */
  private async paidFeaturesActive(): Promise<boolean> {
    if (!this.config.paidFeaturesEnabled) return false;
    const rows = await this.db.query<{ value: { paidFeaturesEnabled?: boolean } }>(
      `SELECT value FROM admin_config WHERE key = 'features'`,
    );
    return rows[0]?.value?.paidFeaturesEnabled === true;
  }

  private async plan(code: string): Promise<PlanRow | undefined> {
    const rows = await this.db.query<PlanRow>(
      `SELECT code, limits, features, grace_days FROM plans WHERE code = $1 AND active`,
      [code],
    );
    return rows[0];
  }

  /**
   * Effective entitlement is recomputed on every call from server rows. A client
   * never supplies a plan, price, or limit. Expired grace always falls back to
   * the free plan, so a failed renewal cannot leave premium access switched on.
   */
  async limits(userId: string): Promise<PlanLimits> {
    const paidActive = await this.paidFeaturesActive();
    const subscriptions = paidActive ? await this.db.query<SubscriptionRow>(
      `SELECT plan_code, status, expires_at, grace_until FROM subscriptions
       WHERE user_id = $1 AND status IN ('active', 'in_grace', 'canceled')
       ORDER BY created_at DESC LIMIT 1`,
      [userId],
    ) : [];
    const subscription = subscriptions[0];
    let planCode = 'free';
    let source: PlanLimits['source'] = 'free';
    let status = 'free';
    let expiresAt: string | null = null;

    if (subscription) {
      const end = subscription.grace_until ?? subscription.expires_at;
      const stillEntitled = !end || new Date(end).getTime() > Date.now();
      if (stillEntitled) {
        planCode = subscription.plan_code;
        source = 'subscription';
        status = subscription.status;
        expiresAt = end ? new Date(end).toISOString() : null;
      }
    }

    if (source === 'free' && paidActive) {
      const grants = await this.db.query<{ value: { planCode?: string }; expires_at: Date | null }>(
        `SELECT value, expires_at FROM user_grants
         WHERE user_id = $1 AND kind = 'plan_days' AND (expires_at IS NULL OR expires_at > now())
         ORDER BY expires_at DESC NULLS LAST LIMIT 1`,
        [userId],
      );
      const grantPlan = grants[0]?.value?.planCode;
      if (grantPlan && (await this.plan(grantPlan))) {
        planCode = grantPlan;
        source = 'grant';
        status = 'granted';
        expiresAt = grants[0].expires_at ? new Date(grants[0].expires_at).toISOString() : null;
      }
    }

    const plan = (await this.plan(planCode)) ?? (await this.plan('free'));
    const limits = plan?.limits ?? {};
    const features = plan?.features ?? {};
    const posterGrants = await this.db.query<{ value: { template?: string } }>(
      `SELECT value FROM user_grants
       WHERE user_id = $1 AND kind = 'poster_template' AND (expires_at IS NULL OR expires_at > now())`,
      [userId],
    );
    const override = await this.db.query<{ convoy_capacity: number; extra: Record<string, unknown> }>(
      `SELECT convoy_capacity, extra FROM user_entitlements WHERE user_id = $1`,
      [userId],
    );
    const extra = override[0]?.extra ?? {};
    return {
      planCode: plan?.code ?? planCode,
      source,
      status,
      expiresAt,
      convoyCapacity: numberLimit(
        override[0]?.convoy_capacity ?? extra.convoyCapacity ?? limits.convoyCapacity,
        3,
      ),
      albumQuotaBytes: numberLimit(extra.albumQuotaBytes ?? limits.albumQuotaBytes, 209_715_200),
      vehicleLimit: numberLimit(extra.vehicleLimit ?? limits.vehicleLimit, 3),
      posterTemplates: [
        ...new Set([
          ...(Array.isArray(limits.posterTemplates) ? limits.posterTemplates.map(String) : ['first_light']),
          ...posterGrants.map((grant) => grant.value?.template).filter((value): value is string => Boolean(value)),
        ]),
      ],
      features,
    };
  }
}
