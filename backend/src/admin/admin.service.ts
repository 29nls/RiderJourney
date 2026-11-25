import {
  BadRequestException, ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.js';
import { BillingService } from '../billing/billing.service.js';
import { RedeemService } from '../redeem/redeem.service.js';
import { RetentionService } from '../ops/retention.service.js';
import { AdminAuditService } from './admin.audit.js';
import { AdminStepUpService } from './step-up.service.js';
import { hasPermission, type AdminActor, type AdminPermission } from './admin.types.js';
import type {
  AuditQueryDto, CommunityModerationDto, CreateRedeemDto, GrantSubscriptionDto,
  ListQueryDto, PostModerationDto, ResolveReportDto, UpdateConfigDto, UserStatusDto,
} from './admin.dto.js';

@Injectable()
export class AdminService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    private readonly audit: AdminAuditService,
    private readonly stepUp: AdminStepUpService,
    private readonly billing: BillingService,
    private readonly redeem: RedeemService,
    private readonly retention: RetentionService,
  ) {}

  private allow(actor: AdminActor, permission: AdminPermission): void {
    if (!hasPermission(actor.role, permission)) {
      throw new ForbiddenException({
        code: 'ADMIN_PERMISSION_DENIED',
        title: 'Izin tidak cukup',
        detail: `Peran ${actor.role} tidak memiliki izin ${permission}.`,
      });
    }
  }

  private limit(value?: number): number {
    return Math.min(Math.max(value ?? 50, 1), 100);
  }

  async me(actor: AdminActor) {
    const permissions: AdminPermission[] = [
      'dashboard.read', 'users.read', 'users.suspend', 'users.ban', 'reports.read', 'reports.act',
      'posts.read', 'posts.moderate', 'communities.read', 'communities.moderate', 'subscriptions.read',
      'subscriptions.manage', 'redeem.manage', 'config.read', 'config.write', 'audit.read', 'jobs.run',
      'billing.reconcile',
    ];
    return {
      userId: actor.userId,
      role: actor.role,
      permissions: permissions.filter((permission) => hasPermission(actor.role, permission)),
      mfa: await this.stepUp.status(actor.userId),
    };
  }

  async dashboard(actor: AdminActor) {
    this.allow(actor, 'dashboard.read');
    const rows = await this.db.query<Record<string, string>>(
      `SELECT
         (SELECT count(*)::text FROM users WHERE status = 'active') AS active_users,
         (SELECT count(*)::text FROM users WHERE status = 'suspended') AS suspended_users,
         (SELECT count(*)::text FROM content_reports WHERE status = 'pending') AS pending_reports,
         (SELECT count(*)::text FROM communities WHERE moderation_status = 'visible') AS communities,
         (SELECT count(*)::text FROM posts WHERE status = 'published' AND deleted_at IS NULL) AS posts,
         (SELECT count(*)::text FROM subscriptions WHERE status IN ('active','in_grace','canceled')) AS subscriptions,
         (SELECT coalesce(sum(used_bytes), 0)::text FROM albums) AS media_bytes,
         (SELECT count(*)::text FROM admin_audit_logs WHERE created_at > now() - interval '24 hours') AS admin_actions_24h`,
    );
    const row = rows[0] ?? {};
    return {
      activeUsers: Number(row.active_users ?? 0),
      suspendedUsers: Number(row.suspended_users ?? 0),
      pendingReports: Number(row.pending_reports ?? 0),
      communities: Number(row.communities ?? 0),
      posts: Number(row.posts ?? 0),
      subscriptions: Number(row.subscriptions ?? 0),
      mediaBytes: Number(row.media_bytes ?? 0),
      adminActions24h: Number(row.admin_actions_24h ?? 0),
    };
  }

  async listUsers(actor: AdminActor, query: ListQueryDto) {
    this.allow(actor, 'users.read');
    const q = query.q?.trim() || null;
    const rows = await this.db.query(
      `SELECT u.id, u.email, u.username, u.display_name, u.status, u.created_at,
              a.role,
              (SELECT s.plan_code FROM subscriptions s WHERE s.user_id = u.id
                 AND s.status IN ('active','in_grace','canceled','paused','on_hold')
               ORDER BY s.created_at DESC LIMIT 1) AS plan_code
       FROM users u LEFT JOIN admin_users a ON a.user_id = u.id
       WHERE ($1::text IS NULL OR u.email ILIKE '%' || $1 || '%' OR u.username ILIKE '%' || $1 || '%'
              OR u.display_name ILIKE '%' || $1 || '%')
         AND ($2::text IS NULL OR u.status = $2)
       ORDER BY u.created_at DESC LIMIT $3`,
      [q, query.status?.trim() || null, this.limit(query.limit)],
    );
    return {
      items: rows.map((row: Record<string, unknown>) => ({
        id: row.id,
        email: row.email,
        username: row.username,
        displayName: row.display_name,
        status: row.status,
        role: row.role ?? null,
        planCode: row.plan_code ?? 'free',
        createdAt: new Date(row.created_at as Date).toISOString(),
      })),
    };
  }

  async userDetail(actor: AdminActor, userId: string) {
    this.allow(actor, 'users.read');
    const rows = await this.db.query(
      `SELECT u.id, u.email, u.username, u.display_name, u.bio, u.city, u.avatar_url,
              u.visibility, u.status, u.email_verified, u.created_at, a.role, a.disabled,
              (SELECT count(*)::text FROM vehicles v WHERE v.owner_id = u.id AND v.deleted_at IS NULL) AS vehicles,
              (SELECT count(*)::text FROM posts p WHERE p.author_id = u.id AND p.deleted_at IS NULL) AS posts,
              (SELECT count(*)::text FROM content_reports r WHERE r.target_type = 'user' AND r.target_id = u.id) AS report_count
       FROM users u LEFT JOIN admin_users a ON a.user_id = u.id
       WHERE u.id = $1`,
      [userId],
    );
    if (!rows[0]) throw new NotFoundException({ code: 'USER_NOT_FOUND', title: 'Pengguna tidak ditemukan', detail: 'ID tidak ada.' });
    const deletion = await this.db.query(
      `SELECT id, status, execute_after FROM data_deletion_requests WHERE user_id = $1 ORDER BY requested_at DESC LIMIT 1`,
      [userId],
    );
    let subscription: unknown = null;
    try {
      subscription = await this.billing.adminSubscription(userId);
    } catch {
      subscription = null;
    }
    return {
      user: {
        id: rows[0].id,
        email: rows[0].email,
        username: rows[0].username,
        displayName: rows[0].display_name,
        bio: rows[0].bio,
        city: rows[0].city,
        avatarUrl: rows[0].avatar_url,
        visibility: rows[0].visibility,
        status: rows[0].status,
        emailVerified: rows[0].email_verified,
        role: rows[0].role ?? null,
        createdAt: new Date(rows[0].created_at as Date).toISOString(),
      },
      counts: {
        vehicles: Number(rows[0].vehicles ?? 0),
        posts: Number(rows[0].posts ?? 0),
        reports: Number(rows[0].report_count ?? 0),
      },
      subscription,
      deletion: deletion[0] ?? null,
    };
  }

  async setUserStatus(actor: AdminActor, userId: string, dto: UserStatusDto, requestId?: string) {
    this.allow(actor, dto.status === 'suspended' ? 'users.suspend' : 'users.suspend');
    if (actor.userId === userId) {
      throw new ForbiddenException({ code: 'SELF_MODERATION', title: 'Tidak dapat mengubah akun sendiri', detail: 'Gunakan akun admin lain.' });
    }
    const target = await this.db.query<{ id: string; status: string; role: string | null }>(
      `SELECT u.id, u.status, a.role FROM users u LEFT JOIN admin_users a ON a.user_id = u.id WHERE u.id = $1`,
      [userId],
    );
    if (!target[0]) throw new NotFoundException({ code: 'USER_NOT_FOUND', title: 'Pengguna tidak ditemukan', detail: 'ID tidak ada.' });
    if (target[0].role && actor.role !== 'superadmin') {
      throw new ForbiddenException({ code: 'ADMIN_TARGET_FORBIDDEN', title: 'Tidak dapat menindak admin', detail: 'Hanya superadmin yang dapat menindak akun admin.' });
    }
    await this.db.transaction(async (tx) => {
      await tx.query(`UPDATE users SET status = $2, updated_at = now() WHERE id = $1`, [userId, dto.status]);
      if (dto.status === 'suspended') {
        await tx.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
      }
      await this.audit.record({
        actorId: actor.userId,
        action: dto.status === 'suspended' ? 'user.suspend' : 'user.restore',
        targetType: 'user',
        targetId: userId,
        reason: dto.reason,
        before: { status: target[0].status },
        after: { status: dto.status, note: dto.note ?? null },
        requestId,
      }, tx);
    });
    return { id: userId, status: dto.status };
  }

  async listReports(actor: AdminActor, query: ListQueryDto) {
    this.allow(actor, 'reports.read');
    const rows = await this.db.query(
      `SELECT r.id, r.target_type, r.target_id, r.reason, r.detail, r.note, r.status,
              r.created_at, r.moderated_at, r.resolution_note,
              reporter.username AS reporter_username, moderator.username AS moderator_username
       FROM content_reports r
       JOIN users reporter ON reporter.id = r.reporter_id
       LEFT JOIN users moderator ON moderator.id = r.moderated_by
       WHERE ($1::text IS NULL OR r.status = $1)
       ORDER BY r.created_at DESC LIMIT $2`,
      [query.status?.trim() || null, this.limit(query.limit)],
    );
    return {
      items: rows.map((row: Record<string, unknown>) => ({
        id: row.id,
        targetType: row.target_type,
        targetId: row.target_id,
        reason: row.reason,
        detail: row.detail,
        note: row.note,
        status: row.status,
        reporter: row.reporter_username,
        moderator: row.moderator_username,
        resolutionNote: row.resolution_note,
        createdAt: new Date(row.created_at as Date).toISOString(),
        moderatedAt: row.moderated_at ? new Date(row.moderated_at as Date).toISOString() : null,
      })),
    };
  }

  async resolveReport(actor: AdminActor, reportId: string, dto: ResolveReportDto, requestId?: string) {
    this.allow(actor, 'reports.act');
    const rows = await this.db.query<{ id: string; status: string }>(`SELECT id, status FROM content_reports WHERE id = $1`, [reportId]);
    if (!rows[0]) throw new NotFoundException({ code: 'REPORT_NOT_FOUND', title: 'Laporan tidak ditemukan', detail: 'ID tidak ada.' });
    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE content_reports SET status = $2, moderated_by = $3, moderated_at = now(), resolution_note = $4 WHERE id = $1`,
        [reportId, dto.status, actor.userId, dto.reason],
      );
      await this.audit.record({
        actorId: actor.userId,
        action: `report.${dto.status}`,
        targetType: 'report',
        targetId: reportId,
        reason: dto.reason,
        before: { status: rows[0].status },
        after: { status: dto.status, resolutionNote: dto.reason },
        requestId,
      }, tx);
    });
    return { id: reportId, status: dto.status };
  }

  async listPosts(actor: AdminActor, query: ListQueryDto) {
    this.allow(actor, 'posts.read');
    const rows = await this.db.query(
      `SELECT p.id, p.kind, p.audience, p.caption, p.status, p.created_at,
              u.username AS author_username, c.name AS community_name
       FROM posts p JOIN users u ON u.id = p.author_id
       LEFT JOIN communities c ON c.id = p.community_id
       WHERE p.deleted_at IS NULL AND ($1::text IS NULL OR p.status = $1)
       ORDER BY p.created_at DESC LIMIT $2`,
      [query.status?.trim() || null, this.limit(query.limit)],
    );
    return {
      items: rows.map((row: Record<string, unknown>) => ({
        id: row.id,
        kind: row.kind,
        audience: row.audience,
        caption: row.caption,
        status: row.status,
        author: row.author_username,
        community: row.community_name ?? null,
        createdAt: new Date(row.created_at as Date).toISOString(),
      })),
    };
  }

  async moderatePost(actor: AdminActor, postId: string, dto: PostModerationDto, requestId?: string) {
    this.allow(actor, 'posts.moderate');
    const rows = await this.db.query<{ id: string; status: string }>(`SELECT id, status FROM posts WHERE id = $1`, [postId]);
    if (!rows[0]) throw new NotFoundException({ code: 'POST_NOT_FOUND', title: 'Post tidak ditemukan', detail: 'ID tidak ada.' });
    const status = dto.action === 'hide' ? 'hidden' : dto.action === 'remove' ? 'removed' : 'published';
    await this.db.transaction(async (tx) => {
      await tx.query(`UPDATE posts SET status = $2, updated_at = now() WHERE id = $1`, [postId, status]);
      await this.audit.record({
        actorId: actor.userId,
        action: `post.${dto.action}`,
        targetType: 'post',
        targetId: postId,
        reason: dto.reason,
        before: { status: rows[0].status },
        after: { status },
        requestId,
      }, tx);
    });
    return { id: postId, status };
  }

  async listCommunities(actor: AdminActor, query: ListQueryDto) {
    this.allow(actor, 'communities.read');
    const q = query.q?.trim() || null;
    const rows = await this.db.query(
      `SELECT c.id, c.slug, c.name, c.visibility, c.moderation_status, c.moderation_reason,
              c.moderated_at, c.created_at, u.username AS owner_username,
              (SELECT count(*)::text FROM community_members m WHERE m.community_id = c.id) AS member_count
       FROM communities c JOIN users u ON u.id = c.owner_id
       WHERE ($1::text IS NULL OR c.name ILIKE '%' || $1 || '%' OR c.slug ILIKE '%' || $1 || '%')
         AND ($2::text IS NULL OR c.moderation_status = $2)
       ORDER BY c.created_at DESC LIMIT $3`,
      [q, query.status?.trim() || null, this.limit(query.limit)],
    );
    return {
      items: rows.map((row: Record<string, unknown>) => ({
        id: row.id,
        slug: row.slug,
        name: row.name,
        visibility: row.visibility,
        moderationStatus: row.moderation_status,
        moderationReason: row.moderation_reason,
        owner: row.owner_username,
        members: Number(row.member_count ?? 0),
        createdAt: new Date(row.created_at as Date).toISOString(),
        moderatedAt: row.moderated_at ? new Date(row.moderated_at as Date).toISOString() : null,
      })),
    };
  }

  async moderateCommunity(actor: AdminActor, communityId: string, dto: CommunityModerationDto, requestId?: string) {
    this.allow(actor, 'communities.moderate');
    const rows = await this.db.query<{ id: string; moderation_status: string }>(
      `SELECT id, moderation_status FROM communities WHERE id = $1`,
      [communityId],
    );
    if (!rows[0]) throw new NotFoundException({ code: 'COMMUNITY_NOT_FOUND', title: 'Komunitas tidak ditemukan', detail: 'ID tidak ada.' });
    const status = dto.action === 'hide' ? 'hidden' : dto.action === 'remove' ? 'removed' : 'visible';
    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE communities SET moderation_status = $2, moderation_reason = $3, moderated_at = now(), updated_at = now() WHERE id = $1`,
        [communityId, status, dto.reason],
      );
      await this.audit.record({
        actorId: actor.userId,
        action: `community.${dto.action}`,
        targetType: 'community',
        targetId: communityId,
        reason: dto.reason,
        before: { moderationStatus: rows[0].moderation_status },
        after: { moderationStatus: status },
        requestId,
      }, tx);
    });
    return { id: communityId, moderationStatus: status };
  }

  async listSubscriptions(actor: AdminActor, query: ListQueryDto) {
    this.allow(actor, 'subscriptions.read');
    const rows = await this.db.query(
      `SELECT s.id, s.plan_code, s.provider, s.status, s.product_id, s.auto_renew,
              s.started_at, s.expires_at, s.grace_until, s.last_verified_at,
              u.username, u.email
       FROM subscriptions s JOIN users u ON u.id = s.user_id
       WHERE ($1::text IS NULL OR s.status = $1)
       ORDER BY s.created_at DESC LIMIT $2`,
      [query.status?.trim() || null, this.limit(query.limit)],
    );
    return {
      items: rows.map((row: Record<string, unknown>) => ({
        id: row.id,
        planCode: row.plan_code,
        provider: row.provider,
        status: row.status,
        productId: row.product_id,
        autoRenew: row.auto_renew,
        username: row.username,
        email: row.email,
        startedAt: new Date(row.started_at as Date).toISOString(),
        expiresAt: row.expires_at ? new Date(row.expires_at as Date).toISOString() : null,
        graceUntil: row.grace_until ? new Date(row.grace_until as Date).toISOString() : null,
        lastVerifiedAt: row.last_verified_at ? new Date(row.last_verified_at as Date).toISOString() : null,
      })),
    };
  }

  async grantSubscription(actor: AdminActor, dto: GrantSubscriptionDto, requestId?: string) {
    this.allow(actor, 'subscriptions.manage');
    const features = await this.db.query<{ value: { paidFeaturesEnabled?: boolean } }>(
      `SELECT value FROM admin_config WHERE key = 'features'`,
    );
    if (!this.config.paidFeaturesEnabled || features[0]?.value?.paidFeaturesEnabled !== true) {
      throw new ConflictException({
        code: 'PAID_FEATURES_DISABLED',
        title: 'Fitur berbayar belum aktif',
        detail: 'PAID_FEATURES_ENABLED dan kill switch admin harus aktif hanya setelah kebijakan serta legal siap.',
      });
    }
    const plans = await this.db.query<{ code: string; active: boolean }>(`SELECT code, active FROM plans WHERE code = $1`, [dto.planCode]);
    if (!plans[0] || !plans[0].active) {
      throw new UnprocessableEntityException({ code: 'PLAN_UNKNOWN', title: 'Paket tidak dikenal', detail: 'Paket tidak aktif.' });
    }
    const users = await this.db.query<{ id: string }>(`SELECT id FROM users WHERE id = $1`, [dto.userId]);
    if (!users[0]) throw new NotFoundException({ code: 'USER_NOT_FOUND', title: 'Pengguna tidak ditemukan', detail: 'ID tidak ada.' });
    const id = uuidv7();
    await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE subscriptions SET status = 'expired', updated_at = now()
         WHERE user_id = $1 AND status IN ('active','in_grace','canceled','paused','on_hold')`,
        [dto.userId],
      );
      await tx.query(
        `INSERT INTO subscriptions (id, user_id, plan_code, provider, provider_subscription_id, product_id, status, auto_renew, expires_at, raw)
         VALUES ($1, $2, $3, 'manual', $4, 'manual_grant', 'active', false, now() + ($5 || ' days')::interval, $6::jsonb)`,
        [id, dto.userId, dto.planCode, `manual:${id}`, dto.days, JSON.stringify({ grantedBy: actor.userId, reason: dto.reason })],
      );
      await this.audit.record({
        actorId: actor.userId,
        action: 'subscription.grant',
        targetType: 'user',
        targetId: dto.userId,
        reason: dto.reason,
        before: null,
        after: { planCode: dto.planCode, days: dto.days, subscriptionId: id },
        requestId,
      }, tx);
    });
    return { id, planCode: dto.planCode, days: dto.days };
  }

  async listRedeem(actor: AdminActor) {
    this.allow(actor, 'redeem.manage');
    return this.redeem.list();
  }

  async createRedeem(actor: AdminActor, dto: CreateRedeemDto, requestId?: string) {
    this.allow(actor, 'redeem.manage');
    const created = await this.redeem.create(actor.userId, dto);
    await this.audit.record({
      actorId: actor.userId,
      action: 'redeem.create',
      targetType: 'redeem',
      targetId: created.id,
      reason: dto.reason,
      before: null,
      after: { rewardKind: dto.rewardKind, rewardValue: dto.rewardValue, quotaTotal: dto.quotaTotal, codePrefix: created.codePrefix },
      requestId,
    });
    return created;
  }

  async disableRedeem(actor: AdminActor, id: string, reason: string, requestId?: string) {
    this.allow(actor, 'redeem.manage');
    const result = await this.redeem.disable(id);
    await this.audit.record({
      actorId: actor.userId,
      action: 'redeem.disable',
      targetType: 'redeem',
      targetId: id,
      reason,
      before: { active: true },
      after: { active: false },
      requestId,
    });
    return result;
  }

  async listConfig(actor: AdminActor) {
    this.allow(actor, 'config.read');
    const rows = await this.db.query(
      `SELECT c.key, c.value, c.updated_at, u.username AS updated_by
       FROM admin_config c LEFT JOIN users u ON u.id = c.updated_by ORDER BY c.key`,
    );
    return {
      items: rows.map((row: Record<string, unknown>) => ({
        key: row.key,
        value: row.value,
        updatedBy: row.updated_by ?? null,
        updatedAt: new Date(row.updated_at as Date).toISOString(),
      })),
    };
  }

  private validateConfig(key: string, value: Record<string, unknown>): void {
    if (key === 'features') {
      const allowed = ['billingEnabled', 'paidFeaturesEnabled'];
      if (Object.keys(value).some((name) => !allowed.includes(name))) {
        throw new BadRequestException({ code: 'CONFIG_INVALID', title: 'Konfigurasi fitur tidak valid', detail: 'Hanya billingEnabled dan paidFeaturesEnabled.' });
      }
      if (Object.values(value).some((entry) => typeof entry !== 'boolean')) {
        throw new BadRequestException({ code: 'CONFIG_INVALID', title: 'Konfigurasi fitur tidak valid', detail: 'Nilai harus boolean.' });
      }
    } else if (key === 'app_version') {
      for (const field of ['minimumVersion', 'latestVersion']) {
        if (typeof value[field] !== 'string' || !/^\d+\.\d+\.\d+$/.test(String(value[field]))) {
          throw new BadRequestException({ code: 'CONFIG_INVALID', title: 'Versi aplikasi tidak valid', detail: 'Gunakan format semver, mis. 1.4.0.' });
        }
      }
      if (typeof value.forceUpdate !== 'boolean') {
        throw new BadRequestException({ code: 'CONFIG_INVALID', title: 'Konfigurasi versi tidak valid', detail: 'forceUpdate harus boolean.' });
      }
    } else if (key === 'retention') {
      for (const field of ['exportDays', 'deletionGraceDays', 'notificationDays', 'billingEventDays']) {
        const number = Number(value[field]);
        if (!Number.isInteger(number) || number < 1 || number > 3650) {
          throw new BadRequestException({ code: 'CONFIG_INVALID', title: 'Retensi tidak valid', detail: `${field} harus 1-3650 hari.` });
        }
      }
    } else {
      throw new BadRequestException({ code: 'CONFIG_KEY_FORBIDDEN', title: 'Kunci konfigurasi tidak dikenal', detail: 'Gunakan features, app_version, atau retention.' });
    }
  }

  async updateConfig(actor: AdminActor, dto: UpdateConfigDto, requestId?: string) {
    this.allow(actor, 'config.write');
    this.validateConfig(dto.key, dto.value);
    const previous = await this.db.query<{ value: Record<string, unknown> }>(`SELECT value FROM admin_config WHERE key = $1`, [dto.key]);
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO admin_config (key, value, updated_by, updated_at) VALUES ($1, $2::jsonb, $3, now())
         ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_by = EXCLUDED.updated_by, updated_at = now()`,
        [dto.key, JSON.stringify(dto.value), actor.userId],
      );
      await this.audit.record({
        actorId: actor.userId,
        action: 'config.update',
        targetType: 'config',
        targetId: null,
        reason: dto.reason,
        before: previous[0]?.value ?? null,
        after: dto.value,
        requestId,
      }, tx);
    });
    return { key: dto.key, value: dto.value };
  }

  async auditLogs(actor: AdminActor, query: AuditQueryDto) {
    this.allow(actor, 'audit.read');
    const rows = await this.db.query(
      `SELECT l.id, l.action, l.target_type, l.target_id, l.reason, l.before, l.after,
              l.request_id, l.created_at, u.username AS actor_username
       FROM admin_audit_logs l LEFT JOIN users u ON u.id = l.actor_id
       WHERE ($1::text IS NULL OR l.action = $1)
         AND ($2::text IS NULL OR u.username ILIKE '%' || $2 || '%')
       ORDER BY l.created_at DESC LIMIT $3`,
      [query.action?.trim() || null, query.actor?.trim() || null, this.limit(query.limit)],
    );
    return {
      items: rows.map((row: Record<string, unknown>) => ({
        id: row.id,
        actor: row.actor_username ?? 'deleted',
        action: row.action,
        targetType: row.target_type,
        targetId: row.target_id,
        reason: row.reason,
        before: row.before,
        after: row.after,
        requestId: row.request_id,
        createdAt: new Date(row.created_at as Date).toISOString(),
      })),
    };
  }

  async listJobs(actor: AdminActor) {
    this.allow(actor, 'jobs.run');
    return this.retention.runs();
  }

  async runRetention(actor: AdminActor, requestId?: string) {
    this.allow(actor, 'jobs.run');
    const result = await this.retention.run();
    await this.audit.record({
      actorId: actor.userId,
      action: 'job.retention',
      targetType: 'job',
      targetId: null,
      reason: 'Menjalankan retensi terjadwal secara manual.',
      before: null,
      after: result,
      requestId,
    });
    return result;
  }

  async reconcileBilling(actor: AdminActor, requestId?: string) {
    this.allow(actor, 'billing.reconcile');
    const result = await this.billing.reconcile();
    await this.audit.record({
      actorId: actor.userId,
      action: 'job.billing_reconcile',
      targetType: 'job',
      targetId: null,
      reason: 'Rekonsiliasi status langganan dengan provider.',
      before: null,
      after: result,
      requestId,
    });
    return result;
  }
}
