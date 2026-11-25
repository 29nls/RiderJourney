import {
  ConflictException, Inject, Injectable, Logger, NotFoundException, ServiceUnavailableException,
  UnauthorizedException, UnprocessableEntityException,
} from '@nestjs/common';
import { timingSafeEqual } from 'node:crypto';
import { redact } from '../common/redact.js';
import { v7 as uuidv7 } from 'uuid';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { decryptValue, encryptValue, sha256 } from '../common/crypto.js';
import { isUniqueViolation } from '../common/db-errors.js';
import { DATABASE, type Database } from '../db/database.js';
import { PlanService } from '../entitlements/plan.service.js';
import { PURCHASE_VERIFIER, type PurchaseVerifier, type VerifiedPurchase } from './billing.types.js';

type PlanRow = {
  code: string;
  name: string;
  billing_enabled: boolean;
  play_product_id: string | null;
  grace_days: number;
  limits: Record<string, unknown>;
  features: Record<string, unknown>;
};

type SubscriptionRow = {
  id: string;
  user_id: string;
  plan_code: string;
  provider: string;
  status: string;
  product_id: string;
  base_plan_id: string | null;
  auto_renew: boolean;
  started_at: Date;
  expires_at: Date | null;
  grace_until: Date | null;
  last_verified_at: Date | null;
  token_encrypted: string | null;
};

@Injectable()
export class BillingService {
  private readonly logger = new Logger(BillingService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(PURCHASE_VERIFIER) private readonly verifier: PurchaseVerifier,
    private readonly plans: PlanService,
  ) {}

  private async flags(): Promise<{ billingEnabled: boolean; paidFeaturesEnabled: boolean }> {
    const rows = await this.db.query<{ value: { billingEnabled?: boolean; paidFeaturesEnabled?: boolean } }>(
      `SELECT value FROM admin_config WHERE key = 'features'`,
    );
    const features = rows[0]?.value ?? {};
    return {
      billingEnabled: this.config.billingEnabled && features.billingEnabled === true,
      paidFeaturesEnabled: this.config.paidFeaturesEnabled && features.paidFeaturesEnabled === true,
    };
  }

  private async assertEnabled(): Promise<void> {
    const flags = await this.flags();
    if (!flags.billingEnabled) {
      throw new ConflictException({
        code: 'BILLING_DISABLED',
        title: 'Pembelian belum diaktifkan',
        detail: 'Fitur berbayar menunggu konfigurasi provider, kebijakan, dan persetujuan legal.',
      });
    }
  }

  private sealToken(token: string): string {
    if (!this.config.contactKey) {
      throw new ServiceUnavailableException({
        code: 'BILLING_ENCRYPTION_MISSING',
        title: 'Penyimpanan token pembelian belum dikonfigurasi',
        detail: 'CONTACT_ENCRYPTION_KEY diperlukan untuk rekonsiliasi.',
      });
    }
    const sealed = encryptValue(token, this.config.contactKey);
    return JSON.stringify({
      v: sealed.keyVersion,
      iv: sealed.iv.toString('base64url'),
      tag: sealed.tag.toString('base64url'),
      ct: sealed.ciphertext.toString('base64url'),
    });
  }

  private openToken(sealed: string | null): string | null {
    if (!sealed || !this.config.contactKey) return null;
    try {
      const parts = JSON.parse(sealed) as { iv: string; tag: string; ct: string };
      return decryptValue(
        {
          iv: Buffer.from(parts.iv, 'base64url'),
          tag: Buffer.from(parts.tag, 'base64url'),
          ciphertext: Buffer.from(parts.ct, 'base64url'),
          keyVersion: 1,
        },
        this.config.contactKey,
      );
    } catch {
      return null;
    }
  }

  async catalog() {
    const flags = await this.flags();
    const plans = await this.db.query<PlanRow & { description: string | null }>(
      `SELECT code, name, description, billing_enabled, play_product_id, grace_days, limits, features
       FROM plans WHERE active ORDER BY code`,
    );
    return {
      billingEnabled: flags.billingEnabled,
      paidFeaturesEnabled: flags.paidFeaturesEnabled,
      note: 'Harga dan masa trial ditampilkan oleh Google Play. Backend hanya memetakan produk ke entitlement.',
      plans: plans.map((plan) => ({
        code: plan.code,
        name: plan.name,
        description: plan.description,
        billingEnabled: plan.billing_enabled,
        playProductId: plan.play_product_id,
        graceDays: plan.grace_days,
        limits: plan.limits,
        features: plan.features,
      })),
    };
  }

  private present(row: SubscriptionRow) {
    return {
      id: row.id,
      planCode: row.plan_code,
      provider: row.provider,
      status: row.status,
      productId: row.product_id,
      basePlanId: row.base_plan_id,
      autoRenew: row.auto_renew,
      startedAt: new Date(row.started_at).toISOString(),
      expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
      graceUntil: row.grace_until ? new Date(row.grace_until).toISOString() : null,
      lastVerifiedAt: row.last_verified_at ? new Date(row.last_verified_at).toISOString() : null,
    };
  }

  async current(userId: string) {
    const rows = await this.db.query<SubscriptionRow>(
      `SELECT * FROM subscriptions
       WHERE user_id = $1 AND status IN ('active', 'in_grace', 'canceled', 'paused', 'on_hold')
       ORDER BY created_at DESC LIMIT 1`,
      [userId],
    );
    const limits = await this.plans.limits(userId);
    const flags = await this.flags();
    return {
      subscription: rows[0] ? this.present(rows[0]) : null,
      planCode: limits.planCode,
      entitlements: limits,
      billingEnabled: flags.billingEnabled,
      paidFeaturesEnabled: flags.paidFeaturesEnabled,
    };
  }

  private async resolvePlan(input: { planCode: string; productId: string; basePlanId?: string }): Promise<PlanRow> {
    const plans = await this.db.query<PlanRow>(
      `SELECT code, name, billing_enabled, play_product_id, grace_days, limits, features
       FROM plans WHERE code = $1 AND active`,
      [input.planCode],
    );
    const plan = plans[0];
    if (!plan) throw new UnprocessableEntityException({ code: 'PLAN_UNKNOWN', title: 'Paket tidak dikenal', detail: 'Paket tidak aktif di server.' });
    if (!plan.billing_enabled) {
      throw new ConflictException({ code: 'PLAN_DISABLED', title: 'Paket belum dijual', detail: 'Paket belum diaktifkan untuk pembelian.' });
    }
    const mapping = await this.db.query<{ plan_code: string }>(
      `SELECT plan_code FROM billing_products
       WHERE product_id = $1 AND active AND ($2::text IS NULL OR base_plan_id = $2)`,
      [input.productId, input.basePlanId ?? null],
    );
    const mapped = mapping[0]?.plan_code;
    const direct = plan.play_product_id === input.productId;
    if ((!mapped && !direct) || (mapped && mapped !== plan.code)) {
      throw new UnprocessableEntityException({
        code: 'PRODUCT_NOT_CONFIGURED',
        title: 'Produk tidak terhubung ke paket',
        detail: 'Admin harus memetakan product/base plan ke paket ini.',
      });
    }
    return plan;
  }

  private async apply(userId: string, token: string, plan: PlanRow, verified: VerifiedPurchase) {
    const tokenHash = sha256(token);
    const existing = await this.db.query<{ user_id: string; subscription_id: string | null }>(
      `SELECT user_id, subscription_id FROM billing_purchases WHERE token_hash = $1`,
      [tokenHash],
    );
    if (existing[0]) {
      if (existing[0].user_id !== userId) {
        throw new ConflictException({
          code: 'PURCHASE_ALREADY_BOUND',
          title: 'Pembelian sudah terikat akun lain',
          detail: 'Token pembelian tidak dapat dipakai ulang di akun berbeda.',
        });
      }
      if (existing[0].subscription_id) {
        const rows = await this.db.query<SubscriptionRow>(`SELECT * FROM subscriptions WHERE id = $1`, [existing[0].subscription_id]);
        if (rows[0]) return { subscription: this.present(rows[0]), duplicate: true };
      }
    }
    if (verified.linkedPurchaseToken) {
      const linked = await this.db.query<{ user_id: string }>(
        `SELECT user_id FROM billing_purchases WHERE token_hash = $1`,
        [sha256(verified.linkedPurchaseToken)],
      );
      if (linked[0] && linked[0].user_id !== userId) {
        throw new ConflictException({
          code: 'PURCHASE_ALREADY_BOUND',
          title: 'Pembelian sudah terikat akun lain',
          detail: 'Token pengganti menunjuk pembelian milik akun lain.',
        });
      }
    }

    const expiresAt = verified.expiresAt ? new Date(verified.expiresAt) : null;
    const entitled = ['active', 'in_grace', 'canceled'].includes(verified.state)
      && (!expiresAt || expiresAt.getTime() + plan.grace_days * 86_400_000 > Date.now());
    const status = entitled
      ? verified.state
      : ['pending', 'paused', 'on_hold'].includes(verified.state) ? verified.state : 'expired';
    const graceUntil = status === 'in_grace' && expiresAt
      ? new Date(expiresAt.getTime() + plan.grace_days * 86_400_000)
      : null;
    const id = uuidv7();
    try {
      await this.db.transaction(async (tx) => {
        await tx.query(
          `UPDATE subscriptions SET status = 'expired', updated_at = now()
           WHERE user_id = $1 AND status IN ('active', 'in_grace', 'canceled', 'paused', 'on_hold')`,
          [userId],
        );
        await tx.query(
          `INSERT INTO subscriptions (
             id, user_id, plan_code, provider, provider_subscription_id, token_encrypted,
             product_id, base_plan_id, status, auto_renew, started_at, expires_at,
             grace_until, last_verified_at, raw
           ) VALUES ($1, $2, $3, 'google_play', $4, $5, $6, $7, $8, $9, COALESCE($10, now()), $11, $12, now(), $13::jsonb)`,
          [
            id, userId, plan.code, tokenHash, this.sealToken(token),
            verified.productId, verified.basePlanId, status, verified.autoRenew,
            verified.startedAt, expiresAt, graceUntil, JSON.stringify(verified.raw),
          ],
        );
        await tx.query(
          `INSERT INTO billing_purchases (id, user_id, token_hash, product_id, subscription_id, status, raw)
           VALUES ($1, $2, $3, $4, $5, 'verified', $6::jsonb)`,
          [uuidv7(), userId, tokenHash, verified.productId, id, JSON.stringify(verified.raw)],
        );
        await tx.query(
          `INSERT INTO billing_events (id, user_id, subscription_id, kind, payload)
           VALUES ($1, $2, $3, 'subscription_verified', $4::jsonb)`,
          [uuidv7(), userId, id, JSON.stringify({ planCode: plan.code, status })],
        );
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const raced = await this.db.query<{ user_id: string; subscription_id: string | null }>(
        `SELECT user_id, subscription_id FROM billing_purchases WHERE token_hash = $1`,
        [tokenHash],
      );
      if (raced[0] && raced[0].user_id !== userId) {
        throw new ConflictException({
          code: 'PURCHASE_ALREADY_BOUND',
          title: 'Pembelian sudah terikat akun lain',
          detail: 'Token pembelian tidak dapat dipakai ulang di akun berbeda.',
        });
      }
      if (raced[0]?.subscription_id) {
        const rows = await this.db.query<SubscriptionRow>(`SELECT * FROM subscriptions WHERE id = $1`, [raced[0].subscription_id]);
        if (rows[0]) return { subscription: this.present(rows[0]), duplicate: true };
      }
      throw error;
    }
    const rows = await this.db.query<SubscriptionRow>(`SELECT * FROM subscriptions WHERE id = $1`, [id]);
    return { subscription: this.present(rows[0]), duplicate: false };
  }

  async verify(userId: string, input: { purchaseToken: string; productId: string; basePlanId?: string; planCode: string }) {
    await this.assertEnabled();
    const plan = await this.resolvePlan(input);
    const verified = await this.verifier.verify({
      purchaseToken: input.purchaseToken,
      productId: input.productId,
      basePlanId: input.basePlanId,
    });
    const applied = await this.apply(userId, input.purchaseToken, plan, verified);
    return { ...applied, entitlements: await this.plans.limits(userId) };
  }

  async restore(userId: string, purchases: Array<{ purchaseToken: string; productId: string; basePlanId?: string }>) {
    await this.assertEnabled();
    const results: Array<{ productId: string; ok: boolean; subscription?: unknown; code?: string }> = [];
    for (const purchase of purchases) {
      try {
        const mapping = await this.db.query<{ plan_code: string; base_plan_id: string }>(
          `SELECT plan_code, base_plan_id FROM billing_products
           WHERE product_id = $1 AND active AND ($2::text IS NULL OR base_plan_id = $2) LIMIT 1`,
          [purchase.productId, purchase.basePlanId ?? null],
        );
        const planCode = mapping[0]?.plan_code;
        if (!planCode) {
          results.push({ productId: purchase.productId, ok: false, code: 'PRODUCT_NOT_CONFIGURED' });
          continue;
        }
        const plan = await this.resolvePlan({ planCode, productId: purchase.productId, basePlanId: purchase.basePlanId });
        const verified = await this.verifier.verify(purchase);
        const applied = await this.apply(userId, purchase.purchaseToken, plan, verified);
        results.push({ productId: purchase.productId, ok: true, subscription: applied.subscription });
      } catch (error) {
        const code = error instanceof ConflictException || error instanceof UnprocessableEntityException
          ? (error.getResponse() as { code?: string }).code
          : 'VERIFY_FAILED';
        results.push({ productId: purchase.productId, ok: false, code: code ?? 'VERIFY_FAILED' });
      }
    }
    return { results, entitlements: await this.plans.limits(userId) };
  }

  async notification(secret: string, body: { message?: { data?: string; messageId?: string; attributes?: Record<string, string> } }) {
    await this.assertEnabled();
    if (!this.config.billingNotificationSecret) {
      throw new ServiceUnavailableException({ code: 'BILLING_NOTIFICATION_NOT_CONFIGURED', title: 'Notifikasi billing belum dikonfigurasi', detail: 'BILLING_NOTIFICATION_SECRET belum diatur.' });
    }
    const expected = Buffer.from(this.config.billingNotificationSecret);
    const supplied = Buffer.from(secret ?? '');
    if (expected.length !== supplied.length || !timingSafeEqual(expected, supplied)) {
      throw new UnauthorizedException({ code: 'BILLING_NOTIFICATION_UNAUTHORIZED', title: 'Notifikasi tidak sah', detail: 'Secret notifikasi tidak cocok.' });
    }
    const messageId = body.message?.messageId;
    const data = body.message?.data;
    if (!messageId || !data) {
      throw new UnprocessableEntityException({ code: 'BILLING_NOTIFICATION_INVALID', title: 'Notifikasi tidak valid', detail: 'messageId dan data diperlukan.' });
    }
    let parsed: {
      subscriptionNotification?: { purchaseToken?: string; subscriptionId?: string; notificationType?: number };
      testNotification?: unknown;
    };
    try {
      parsed = JSON.parse(Buffer.from(data, 'base64').toString('utf8'));
    } catch {
      throw new UnprocessableEntityException({ code: 'BILLING_NOTIFICATION_INVALID', title: 'Notifikasi tidak valid', detail: 'Payload bukan JSON base64.' });
    }
    const inserted = await this.db.query<{ message_id: string }>(
      `INSERT INTO billing_notifications (message_id, event_type, payload) VALUES ($1, $2, $3::jsonb)
       ON CONFLICT DO NOTHING RETURNING message_id`,
      [messageId, parsed.subscriptionNotification ? 'subscription' : 'test', JSON.stringify(parsed)],
    );
    if (!inserted[0]) return { duplicate: true, processed: true };

    const notice = parsed.subscriptionNotification;
    if (!notice?.purchaseToken || !notice.subscriptionId) {
      await this.db.query(`UPDATE billing_notifications SET processed_at = now() WHERE message_id = $1`, [messageId]);
      return { duplicate: false, processed: true, ignored: true };
    }
    const tokenHash = sha256(notice.purchaseToken);
    const purchase = await this.db.query<{ user_id: string; product_id: string; subscription_id: string | null }>(
      `SELECT user_id, product_id, subscription_id FROM billing_purchases WHERE token_hash = $1`,
      [tokenHash],
    );
    if (!purchase[0]) {
      await this.db.query(`UPDATE billing_notifications SET error = 'purchase not found', processed_at = now() WHERE message_id = $1`, [messageId]);
      return { duplicate: false, processed: false, error: 'PURCHASE_NOT_FOUND' };
    }
    try {
      const mapping = await this.db.query<{ plan_code: string }>(
        `SELECT plan_code FROM billing_products WHERE product_id = $1 AND active LIMIT 1`,
        [purchase[0].product_id],
      );
      const planCode = mapping[0]?.plan_code;
      if (!planCode) throw new Error('product mapping missing');
      const plan = await this.resolvePlan({ planCode, productId: purchase[0].product_id });
      const verified = await this.verifier.verify({ purchaseToken: notice.purchaseToken, productId: purchase[0].product_id });
      await this.apply(purchase[0].user_id, notice.purchaseToken, plan, verified);
      await this.db.query(`UPDATE billing_notifications SET processed_at = now() WHERE message_id = $1`, [messageId]);
      return { duplicate: false, processed: true };
    } catch (error) {
      const message = error instanceof Error ? error.message : 'notification failed';
      await this.db.query(`UPDATE billing_notifications SET error = $2, processed_at = now() WHERE message_id = $1`, [messageId, message.slice(0, 300)]);
      return { duplicate: false, processed: false, error: message };
    }
  }

  /** Re-checks current rows against the provider so renewals and refunds converge. */
  async reconcile(limit = 50) {
    const rows = await this.db.query<SubscriptionRow>(
      `SELECT * FROM subscriptions
       WHERE status IN ('active', 'in_grace', 'canceled', 'paused', 'on_hold')
         AND token_encrypted IS NOT NULL
         AND (expires_at IS NULL OR expires_at < now() + interval '1 day'
              OR last_verified_at IS NULL OR last_verified_at < now() - interval '1 day')
       ORDER BY COALESCE(last_verified_at, started_at) ASC LIMIT $1`,
      [limit],
    );
    let checked = 0;
    let failed = 0;
    for (const row of rows) {
      const token = this.openToken(row.token_encrypted);
      if (!token) continue;
      try {
        const mapping = await this.db.query<{ plan_code: string }>(
          `SELECT plan_code FROM billing_products WHERE product_id = $1 AND active LIMIT 1`,
          [row.product_id],
        );
        const plan = await this.resolvePlan({ planCode: mapping[0]?.plan_code ?? row.plan_code, productId: row.product_id });
        const verified = await this.verifier.verify({ purchaseToken: token, productId: row.product_id, basePlanId: row.base_plan_id ?? undefined });
        await this.apply(row.user_id, token, plan, verified);
        checked += 1;
      } catch (error) {
        failed += 1;
        this.logger.warn(`billing reconcile failed for ${row.id}: ${error instanceof Error ? redact(error.message) : 'unknown'}`);
      }
    }
    return { candidates: rows.length, checked, failed };
  }

  async adminSubscription(userId: string) {
    const rows = await this.db.query<SubscriptionRow>(
      `SELECT * FROM subscriptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 20`,
      [userId],
    );
    if (rows.length === 0) throw new NotFoundException({ code: 'SUBSCRIPTION_NOT_FOUND', title: 'Langganan tidak ditemukan', detail: 'Pengguna tidak memiliki riwayat langganan.' });
    return { items: rows.map((row) => this.present(row)), entitlements: await this.plans.limits(userId) };
  }
}
