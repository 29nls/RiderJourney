import {
  ConflictException, ForbiddenException, Inject, Injectable, Logger, NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { createHmac, randomBytes } from 'node:crypto';
import { isUniqueViolation } from '../common/db-errors.js';
import { v7 as uuidv7 } from 'uuid';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.js';

type RedeemCodeRow = {
  id: string;
  code_prefix: string;
  reward_kind: string;
  reward_value: Record<string, unknown>;
  quota_total: number;
  quota_used: number;
  expires_at: Date | null;
  active: boolean;
  created_at: Date;
};

type RedemptionRow = {
  id: string;
  code_id: string;
  user_id: string;
  idempotency_key: string;
  reward_kind: string;
  reward_value: Record<string, unknown>;
  created_at: Date;
};

const ALPHABET = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
const TEMPLATES = new Set(['first_light', 'peloton_lines', 'night_odometer']);

@Injectable()
export class RedeemService {
  private readonly logger = new Logger(RedeemService.name);

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  private hash(code: string): string {
    return createHmac('sha256', this.config.redeemCodePepper).update(`redeem:${code.trim().toUpperCase()}`).digest('hex');
  }

  private generateCode(): string {
    const bytes = randomBytes(12);
    return Array.from(bytes, (byte) => ALPHABET[byte % ALPHABET.length]).join('');
  }

  private validateReward(kind: string, value: Record<string, unknown>): void {
    if (kind === 'points') {
      const points = Number(value.points);
      if (!Number.isInteger(points) || points < 1 || points > 1_000_000) {
        throw new UnprocessableEntityException({ code: 'REWARD_INVALID', title: 'Reward poin tidak valid', detail: 'points harus 1 sampai 1.000.000.' });
      }
    } else if (kind === 'subscription_days') {
      const days = Number(value.days);
      if (!Number.isInteger(days) || days < 1 || days > 3650 || typeof value.planCode !== 'string') {
        throw new UnprocessableEntityException({ code: 'REWARD_INVALID', title: 'Reward langganan tidak valid', detail: 'planCode dan days (1-3650) diperlukan.' });
      }
    } else if (kind === 'poster_template') {
      if (typeof value.template !== 'string' || !TEMPLATES.has(value.template)) {
        throw new UnprocessableEntityException({ code: 'REWARD_INVALID', title: 'Reward template tidak valid', detail: 'Template poster tidak dikenal.' });
      }
    } else {
      throw new UnprocessableEntityException({ code: 'REWARD_INVALID', title: 'Reward tidak dikenal', detail: 'Jenis reward tidak didukung.' });
    }
  }

  async create(
    adminId: string,
    dto: { rewardKind: 'points' | 'subscription_days' | 'poster_template'; rewardValue: Record<string, unknown>; quotaTotal: number; expiresAt?: string },
  ) {
    this.validateReward(dto.rewardKind, dto.rewardValue);
    if (dto.rewardKind === 'subscription_days') {
      const plans = await this.db.query<{ code: string }>(`SELECT code FROM plans WHERE code = $1 AND active`, [String(dto.rewardValue.planCode)]);
      if (!plans[0]) throw new UnprocessableEntityException({ code: 'PLAN_UNKNOWN', title: 'Paket tidak dikenal', detail: 'Paket reward tidak aktif.' });
    }
    const code = this.generateCode();
    const id = uuidv7();
    await this.db.query(
      `INSERT INTO redeem_codes (id, code_hash, code_prefix, reward_kind, reward_value, quota_total, expires_at, created_by)
       VALUES ($1, $2, $3, $4, $5::jsonb, $6, $7, $8)`,
      [id, this.hash(code), code.slice(0, 4), dto.rewardKind, JSON.stringify(dto.rewardValue), dto.quotaTotal, dto.expiresAt ?? null, adminId],
    );
    return { id, code, codePrefix: code.slice(0, 4), rewardKind: dto.rewardKind, rewardValue: dto.rewardValue, quotaTotal: dto.quotaTotal, expiresAt: dto.expiresAt ?? null };
  }

  async list() {
    const rows = await this.db.query<RedeemCodeRow>(
      `SELECT id, code_prefix, reward_kind, reward_value, quota_total, quota_used, expires_at, active, created_at
       FROM redeem_codes ORDER BY created_at DESC LIMIT 100`,
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        codePrefix: row.code_prefix,
        rewardKind: row.reward_kind,
        rewardValue: row.reward_value,
        quotaTotal: row.quota_total,
        quotaUsed: row.quota_used,
        remaining: row.quota_total - row.quota_used,
        expiresAt: row.expires_at ? new Date(row.expires_at).toISOString() : null,
        active: row.active,
        createdAt: new Date(row.created_at).toISOString(),
      })),
    };
  }

  async disable(id: string) {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE redeem_codes SET active = false, updated_at = now() WHERE id = $1 AND active RETURNING id`,
      [id],
    );
    if (!rows[0]) throw new NotFoundException({ code: 'REDEEM_CODE_NOT_FOUND', title: 'Kode tidak ditemukan', detail: 'Kode tidak aktif atau tidak ada.' });
    return { id, active: false };
  }

  async redeem(userId: string, dto: { code: string; idempotencyKey: string }) {
    const hash = this.hash(dto.code);
    const existingRetry = await this.db.query<RedemptionRow>(
      `SELECT * FROM redeem_redemptions WHERE user_id = $1 AND idempotency_key = $2`,
      [userId, dto.idempotencyKey],
    );
    if (existingRetry[0]) return { ...this.present(existingRetry[0]), duplicate: true };

    const codes = await this.db.query<{ id: string }>(`SELECT id FROM redeem_codes WHERE code_hash = $1`, [hash]);
    if (!codes[0]) {
      throw new NotFoundException({ code: 'REDEEM_CODE_INVALID', title: 'Kode tidak valid', detail: 'Kode tidak dapat digunakan.' });
    }

    let result: RedemptionRow;
    try {
      result = await this.db.transaction(async (tx) => {
        const locked = await tx.query<RedeemCodeRow & { code_hash: string }>(
          `SELECT * FROM redeem_codes WHERE id = $1 FOR UPDATE`,
          [codes[0].id],
        );
        const code = locked[0];
        if (!code || !code.active) {
          throw new NotFoundException({ code: 'REDEEM_CODE_INVALID', title: 'Kode tidak valid', detail: 'Kode tidak dapat digunakan.' });
        }
        if (code.expires_at && new Date(code.expires_at).getTime() <= Date.now()) {
          throw new ConflictException({ code: 'REDEEM_CODE_EXPIRED', title: 'Kode kedaluwarsa', detail: 'Kode sudah melewati masa berlaku.' });
        }
        if (code.quota_used >= code.quota_total) {
          throw new ConflictException({ code: 'REDEEM_QUOTA_EXHAUSTED', title: 'Kuota kode habis', detail: 'Kode sudah dipakai sesuai kuota.' });
        }
        const already = await tx.query<{ id: string }>(
          `SELECT id FROM redeem_redemptions WHERE code_id = $1 AND user_id = $2`,
          [code.id, userId],
        );
        if (already[0]) {
          throw new ConflictException({ code: 'REDEEM_ALREADY_USED', title: 'Kode sudah dipakai', detail: 'Satu kode hanya dapat dipakai sekali per akun.' });
        }
        const redemptionId = uuidv7();
        const inserted = await tx.query<RedemptionRow>(
          `INSERT INTO redeem_redemptions (id, code_id, user_id, idempotency_key, reward_kind, reward_value)
           VALUES ($1, $2, $3, $4, $5, $6::jsonb) RETURNING *`,
          [redemptionId, code.id, userId, dto.idempotencyKey, code.reward_kind, JSON.stringify(code.reward_value)],
        );
        await tx.query(`UPDATE redeem_codes SET quota_used = quota_used + 1, updated_at = now() WHERE id = $1`, [code.id]);

        if (code.reward_kind === 'points') {
          const points = Number(code.reward_value.points);
          await tx.query(
            `INSERT INTO point_ledger (id, user_id, delta, reason, reference_type, reference_id)
             VALUES ($1, $2, $3, 'redeem_bonus', 'redeem', $4)`,
            [uuidv7(), userId, points, redemptionId],
          );
        } else if (code.reward_kind === 'subscription_days') {
          const days = Number(code.reward_value.days);
          await tx.query(
            `INSERT INTO user_grants (id, user_id, kind, value, source, expires_at)
             VALUES ($1, $2, 'plan_days', $3::jsonb, 'redeem', now() + ($4 || ' days')::interval)`,
            [uuidv7(), userId, JSON.stringify({ planCode: code.reward_value.planCode }), days],
          );
        } else {
          await tx.query(
            `INSERT INTO user_grants (id, user_id, kind, value, source)
             VALUES ($1, $2, 'poster_template', $3::jsonb, 'redeem')`,
            [uuidv7(), userId, JSON.stringify({ template: code.reward_value.template })],
          );
        }
        return inserted[0];
      });
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      const retried = await this.db.query<RedemptionRow>(
        `SELECT * FROM redeem_redemptions WHERE user_id = $1 AND idempotency_key = $2`,
        [userId, dto.idempotencyKey],
      );
      if (retried[0]) return { ...this.present(retried[0]), duplicate: true };
      const used = await this.db.query<{ id: string }>(
        `SELECT id FROM redeem_redemptions WHERE code_id = $1 AND user_id = $2`,
        [codes[0].id, userId],
      );
      if (used[0]) {
        throw new ConflictException({ code: 'REDEEM_ALREADY_USED', title: 'Kode sudah dipakai', detail: 'Satu kode hanya dapat dipakai sekali per akun.' });
      }
      throw error;
    }
    this.logger.log(`redeem ${result.id} fulfilled for ${userId}`);
    return { ...this.present(result), duplicate: false };
  }

  private present(row: RedemptionRow) {
    return {
      id: row.id,
      codeId: row.code_id,
      rewardKind: row.reward_kind,
      rewardValue: row.reward_value,
      redeemedAt: new Date(row.created_at).toISOString(),
    };
  }

  async history(userId: string) {
    const rows = await this.db.query<RedemptionRow>(
      `SELECT * FROM redeem_redemptions WHERE user_id = $1 ORDER BY created_at DESC LIMIT 50`,
      [userId],
    );
    return { items: rows.map((row) => this.present(row)) };
  }
}
