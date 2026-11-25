import { BadRequestException, ConflictException, ForbiddenException, GoneException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import type { Database } from '../db/database.js';
import { DATABASE } from '../db/database.js';
import { v7 as uuidv7 } from 'uuid';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { RealtimeHub } from '../realtime/realtime.hub.js';
import type { StoredPosition } from '../realtime/realtime.types.js';
import { REALTIME_STORE, type RealtimeStore } from '../realtime/realtime.store.js';
import { generateInviteCode, hashInviteCode } from './invite-code.js';
import { canTransition, type ConvoyStatus } from './convoy-state.js';
import type {
  ChangeMemberRoleDto,
  CreateConvoyDto,
  CreateInviteDto,
  JoinConvoyDto,
  UpdateConvoyRouteDto,
} from './convoys.dto.js';
import { EntitlementService } from './entitlement.service.js';

type Queryable = Pick<Database, 'query'>;

type ConvoyRow = {
  id: string;
  leader_id: string;
  name: string;
  meeting_lat: number;
  meeting_lng: number;
  destination_lat: number;
  destination_lng: number;
  waypoints: Array<{ lat: number; lng: number; label?: string }>;
  scheduled_at: Date | null;
  capacity: number;
  status: ConvoyStatus;
  route_id: string | null;
  route_version: number;
  version: number;
  started_at: Date | null;
  paused_at: Date | null;
  completed_at: Date | null;
  cancelled_at: Date | null;
  created_at: Date;
  updated_at: Date;
  my_role?: 'leader' | 'co_leader' | 'member';
  my_status?: 'active' | 'requested' | 'left' | 'removed';
  my_sharing?: boolean;
  active_count?: number;
};

type MemberRow = {
  convoy_id: string;
  user_id: string;
  role: 'leader' | 'co_leader' | 'member';
  status: 'active' | 'requested' | 'left' | 'removed';
  sharing_consent: boolean;
  joined_at: Date | null;
  last_seen_at: Date | null;
  display_name: string;
  username: string;
  avatar_url: string | null;
};

const CONVOY_MEMBER_SELECT = `
  SELECT c.*, cm.role AS my_role, cm.status AS my_status, cm.sharing_consent AS my_sharing,
    ST_Y(c.meeting_point::geometry)::float8 AS meeting_lat,
    ST_X(c.meeting_point::geometry)::float8 AS meeting_lng,
    ST_Y(c.destination::geometry)::float8 AS destination_lat,
    ST_X(c.destination::geometry)::float8 AS destination_lng,
    (SELECT count(*)::int FROM convoy_members m WHERE m.convoy_id = c.id AND m.status = 'active') AS active_count
  FROM convoys c`;

const CONVOY_SELECT = `
  SELECT c.*,
    ST_Y(c.meeting_point::geometry)::float8 AS meeting_lat,
    ST_X(c.meeting_point::geometry)::float8 AS meeting_lng,
    ST_Y(c.destination::geometry)::float8 AS destination_lat,
    ST_X(c.destination::geometry)::float8 AS destination_lng,
    (SELECT count(*)::int FROM convoy_members m WHERE m.convoy_id = c.id AND m.status = 'active') AS active_count
  FROM convoys c`;

function iso(value: Date | null): string | null {
  return value ? new Date(value).toISOString() : null;
}

function notFound(detail = 'Konvoi tidak ditemukan atau Anda bukan anggotanya.'): never {
  throw new NotFoundException({ code: 'CONVOY_NOT_FOUND', title: 'Konvoi tidak ditemukan', detail });
}

export function serializeConvoy(row: ConvoyRow) {
  return {
    id: row.id,
    leaderId: row.leader_id,
    name: row.name,
    meetingPoint: { lat: row.meeting_lat, lng: row.meeting_lng },
    destination: { lat: row.destination_lat, lng: row.destination_lng },
    waypoints: row.waypoints,
    scheduledAt: iso(row.scheduled_at),
    capacity: row.capacity,
    status: row.status,
    routeId: row.route_id,
    routeVersion: row.route_version,
    version: row.version,
    activeMemberCount: row.active_count ?? 0,
    role: row.my_role,
    membershipStatus: row.my_status,
    sharingConsent: row.my_sharing,
    startedAt: iso(row.started_at),
    pausedAt: iso(row.paused_at),
    completedAt: iso(row.completed_at),
    cancelledAt: iso(row.cancelled_at),
    createdAt: iso(row.created_at),
    updatedAt: iso(row.updated_at),
  };
}

export function serializeMember(row: MemberRow) {
  return {
    userId: row.user_id,
    displayName: row.display_name,
    username: row.username,
    avatarUrl: row.avatar_url,
    role: row.role,
    status: row.status,
    sharingConsent: row.sharing_consent,
    joinedAt: iso(row.joined_at),
    lastSeenAt: iso(row.last_seen_at),
  };
}

@Injectable()
export class ConvoysService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REALTIME_STORE) private readonly store: RealtimeStore,
    private readonly hub: RealtimeHub,
    private readonly entitlements: EntitlementService,
  ) {}

  private async convoyForUser(convoyId: string, userId: string, q: Queryable = this.db): Promise<ConvoyRow> {
    const rows = await q.query<ConvoyRow>(
      `${CONVOY_MEMBER_SELECT}
       JOIN convoy_members cm ON cm.convoy_id = c.id AND cm.user_id = $2
       WHERE c.id = $1`,
      [convoyId, userId],
    );
    const row = rows[0];
    if (!row) notFound();
    return row;
  }

  private async convoyById(convoyId: string, q: Queryable = this.db): Promise<ConvoyRow> {
    const rows = await q.query<ConvoyRow>(`${CONVOY_SELECT} WHERE c.id = $1`, [convoyId]);
    if (!rows[0]) notFound();
    return rows[0];
  }

  private requireVisible(row: ConvoyRow): void {
    if (row.my_status === 'removed') notFound();
    if (row.my_status === 'left' && !['completed', 'cancelled'].includes(row.status)) notFound();
  }

  private requireActive(row: ConvoyRow): void {
    if (row.my_status !== 'active') {
      throw new ForbiddenException({ code: 'CONVOY_MEMBERSHIP_INACTIVE', title: 'Akses konvoi ditolak', detail: 'Keanggotaan Anda belum aktif pada konvoi ini.' });
    }
  }

  private requireLeader(row: ConvoyRow): void {
    this.requireActive(row);
    if (row.my_role !== 'leader') {
      throw new ForbiddenException({ code: 'CONVOY_LEADER_ONLY', title: 'Hanya leader', detail: 'Tindakan ini hanya dapat dilakukan oleh leader konvoi.' });
    }
  }

  private requireManager(row: ConvoyRow): void {
    this.requireActive(row);
    if (row.my_role !== 'leader' && row.my_role !== 'co_leader') {
      throw new ForbiddenException({ code: 'CONVOY_MANAGER_ONLY', title: 'Akses ditolak', detail: 'Tindakan ini memerlukan leader atau co-leader.' });
    }
  }

  private assertVersion(row: ConvoyRow, ifMatch?: string): void {
    if (!ifMatch) return;
    const normalized = ifMatch.replace(/^W\//, '').replaceAll('"', '').trim();
    if (normalized !== String(row.version)) {
      throw new ConflictException({
        code: 'VERSION_MISMATCH',
        title: 'Versi konvoi berubah',
        detail: `Versi yang dikirim ${normalized}, versi saat ini ${row.version}. Muat ulang data konvoi.`,
      });
    }
  }

  private async audit(
    q: Queryable,
    convoyId: string,
    actorId: string | null,
    action: string,
    targetUserId: string | null,
    metadata: Record<string, unknown> = {},
  ): Promise<void> {
    await q.query(
      `INSERT INTO convoy_audit_logs (id, convoy_id, actor_id, action, target_user_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [uuidv7(), convoyId, actorId, action, targetUserId, JSON.stringify(metadata)],
    );
  }

  private async bump(q: Queryable, convoyId: string): Promise<number> {
    const rows = await q.query<{ version: number }>(
      'UPDATE convoys SET version = version + 1, updated_at = now() WHERE id = $1 RETURNING version',
      [convoyId],
    );
    return rows[0].version;
  }

  private async createInviteRecord(
    q: Queryable,
    convoyId: string,
    createdBy: string,
    expiresInSeconds: number,
    maxUses: number,
  ): Promise<{ id: string; code: string; expiresAt: Date; maxUses: number }> {
    const code = generateInviteCode(10);
    const id = uuidv7();
    const expiresAt = new Date(Date.now() + expiresInSeconds * 1000);
    await q.query(
      `INSERT INTO convoy_invites (id, convoy_id, created_by, code_hash, expires_at, max_uses)
       VALUES ($1, $2, $3, $4, $5, $6)`,
      [id, convoyId, createdBy, hashInviteCode(code, this.config.inviteHmacPepper), expiresAt, maxUses],
    );
    return { id, code, expiresAt, maxUses };
  }

  private inviteLink(code: string): string {
    return `${this.config.convoyInviteLinkBase}${encodeURIComponent(code)}`;
  }

  async create(userId: string, dto: CreateConvoyDto) {
    const entitlement = await this.entitlements.convoyCapacity(userId);
    const capacity = dto.capacity ?? Math.min(this.config.convoyCapacityDefault, entitlement);
    if (capacity > entitlement) {
      throw new ForbiddenException({
        code: 'CONVOY_CAPACITY_NOT_ENTITLED',
        title: 'Kapasitas tidak tersedia',
        detail: `Paket akun Anda mendukung hingga ${entitlement} anggota. Kapasitas tidak diambil dari nilai paket yang dikirim klien.`,
      });
    }
    if (dto.scheduledAt && new Date(dto.scheduledAt).getTime() < Date.now() - 60_000) {
      throw new BadRequestException({ code: 'SCHEDULE_IN_PAST', title: 'Jadwal tidak valid', detail: 'Waktu mulai tidak boleh di masa lalu.' });
    }

    const created = await this.db.transaction(async (tx) => {
      if (dto.routeId) {
        const routes = await tx.query<{ id: string }>('SELECT id FROM routes WHERE id = $1 AND owner_id = $2', [dto.routeId, userId]);
        if (!routes[0]) throw new NotFoundException({ code: 'ROUTE_NOT_FOUND', title: 'Rute tidak ditemukan', detail: 'Rute tidak tersedia untuk akun ini.' });
      }
      const convoyId = uuidv7();
      const status = dto.status ?? 'lobby';
      await tx.query(
        `INSERT INTO convoys
          (id, leader_id, name, meeting_point, destination, waypoints, scheduled_at, capacity, status, route_id, route_version)
         VALUES ($1, $2, $3, ST_SetSRID(ST_MakePoint($5, $4), 4326)::geography,
                 ST_SetSRID(ST_MakePoint($7, $6), 4326)::geography, $8::jsonb, $9, $10, $11, $12, $13)`,
        [
          convoyId,
          userId,
          dto.name.trim(),
          dto.meetingPoint.lat,
          dto.meetingPoint.lng,
          dto.destination.lat,
          dto.destination.lng,
          JSON.stringify(dto.waypoints ?? []),
          dto.scheduledAt ?? null,
          capacity,
          status,
          dto.routeId ?? null,
          dto.routeId ? 1 : 0,
        ],
      );
      await tx.query(
        `INSERT INTO convoy_members (convoy_id, user_id, role, status, sharing_consent, joined_at)
         VALUES ($1, $2, 'leader', 'active', false, now())`,
        [convoyId, userId],
      );
      const invite = await this.createInviteRecord(tx, convoyId, userId, 86_400, Math.max(1, capacity - 1));
      await this.audit(tx, convoyId, userId, 'convoy.created', null, { status, capacity });
      const row = await this.convoyForUser(convoyId, userId, tx);
      return { row, invite };
    });

    return {
      ...serializeConvoy(created.row),
      inviteCode: created.invite.code,
      inviteLink: this.inviteLink(created.invite.code),
      inviteExpiresAt: created.invite.expiresAt.toISOString(),
    };
  }

  async list(userId: string) {
    const rows = await this.db.query<ConvoyRow>(
      `${CONVOY_MEMBER_SELECT}
       JOIN convoy_members cm ON cm.convoy_id = c.id AND cm.user_id = $1
       WHERE cm.status IN ('active', 'requested')
       ORDER BY c.created_at DESC LIMIT 50`,
      [userId],
    );
    return { items: rows.map(serializeConvoy) };
  }

  async active(userId: string) {
    const rows = await this.db.query<ConvoyRow>(
      `${CONVOY_MEMBER_SELECT}
       JOIN convoy_members cm ON cm.convoy_id = c.id AND cm.user_id = $1
       WHERE cm.status IN ('active', 'requested') AND c.status IN ('draft', 'lobby', 'active', 'paused')
       ORDER BY c.created_at DESC LIMIT 1`,
      [userId],
    );
    return { convoy: rows[0] ? serializeConvoy(rows[0]) : null };
  }

  async get(convoyId: string, userId: string) {
    const row = await this.convoyForUser(convoyId, userId);
    this.requireVisible(row);
    return serializeConvoy(row);
  }

  async members(convoyId: string, userId: string) {
    const convoy = await this.convoyForUser(convoyId, userId);
    this.requireVisible(convoy);
    const includeRequested = convoy.my_role === 'leader' || convoy.my_role === 'co_leader';
    const rows = await this.db.query<MemberRow>(
      `SELECT m.*, u.display_name, u.username, u.avatar_url
       FROM convoy_members m JOIN users u ON u.id = m.user_id
       WHERE m.convoy_id = $1
         AND (m.status = 'active' OR ($2::boolean AND m.status = 'requested') OR ($3::boolean AND m.status IN ('left', 'removed')))
       ORDER BY CASE m.role WHEN 'leader' THEN 0 WHEN 'co_leader' THEN 1 ELSE 2 END, m.joined_at NULLS LAST`,
      [convoyId, includeRequested, convoy.status === 'completed' || convoy.status === 'cancelled'],
    );
    return { items: rows.map(serializeMember) };
  }

  async join(userId: string, dto: JoinConvoyDto) {
    const codeHash = hashInviteCode(dto.code, this.config.inviteHmacPepper);
    const joined = await this.db.transaction(async (tx) => {
      const invites = await tx.query<{
        id: string;
        convoy_id: string;
        created_by: string;
        expires_at: Date;
        max_uses: number;
        used_count: number;
        revoked_at: Date | null;
      }>('SELECT id, convoy_id, created_by, expires_at, max_uses, used_count, revoked_at FROM convoy_invites WHERE code_hash = $1 FOR UPDATE', [codeHash]);
      const invite = invites[0];
      if (!invite) {
        throw new NotFoundException({ code: 'INVITE_INVALID', title: 'Kode undangan tidak valid', detail: 'Periksa kembali kode undangan konvoi.' });
      }
      if (invite.revoked_at) {
        throw new GoneException({ code: 'INVITE_REVOKED', title: 'Undangan dicabut', detail: 'Kode undangan ini sudah dicabut leader.' });
      }
      if (new Date(invite.expires_at).getTime() <= Date.now()) {
        throw new GoneException({ code: 'INVITE_EXPIRED', title: 'Undangan kedaluwarsa', detail: 'Minta kode undangan baru kepada leader.' });
      }
      if (invite.used_count >= invite.max_uses) {
        throw new GoneException({ code: 'INVITE_EXHAUSTED', title: 'Undangan sudah habis', detail: 'Batas pemakaian kode undangan ini sudah tercapai.' });
      }
      const convoys = await tx.query<{ id: string; status: ConvoyStatus; capacity: number }>(
        'SELECT id, status, capacity FROM convoys WHERE id = $1 FOR UPDATE',
        [invite.convoy_id],
      );
      const convoy = convoys[0];
      if (!convoy) notFound();
      if (convoy.status !== 'lobby') {
        throw new ConflictException({ code: 'CONVOY_NOT_JOINABLE', title: 'Konvoi tidak menerima anggota', detail: 'Anggota hanya dapat bergabung saat konvoi berada di lobby.' });
      }
      const open = await tx.query<{ convoy_id: string }>(
        `SELECT convoy_id FROM convoy_members WHERE user_id = $1 AND status IN ('active', 'requested') LIMIT 1`,
        [userId],
      );
      if (open[0]) {
        throw new ConflictException({ code: 'ALREADY_IN_CONVOY', title: 'Sudah berada di konvoi', detail: 'Selesaikan atau keluar dari konvoi aktif sebelum bergabung dengan konvoi lain.' });
      }
      const occupancy = await tx.query<{ count: number }>(
        `SELECT count(*)::int AS count FROM convoy_members WHERE convoy_id = $1 AND status IN ('active', 'requested')`,
        [convoy.id],
      );
      if (occupancy[0].count >= convoy.capacity) {
        throw new ConflictException({ code: 'CONVOY_FULL', title: 'Konvoi penuh', detail: 'Kapasitas konvoi sudah terisi, termasuk permintaan yang menunggu persetujuan.' });
      }
      const used = await tx.query<{ used_count: number }>(
        `UPDATE convoy_invites SET used_count = used_count + 1
         WHERE id = $1 AND used_count < max_uses AND revoked_at IS NULL AND expires_at > now()
         RETURNING used_count`,
        [invite.id],
      );
      if (!used[0]) {
        throw new GoneException({ code: 'INVITE_EXHAUSTED', title: 'Undangan sudah habis', detail: 'Batas pemakaian kode undangan ini sudah tercapai.' });
      }
      await tx.query(
        `INSERT INTO convoy_members (convoy_id, user_id, role, status, sharing_consent, invited_by)
         VALUES ($1, $2, 'member', 'requested', false, $3)
         ON CONFLICT (convoy_id, user_id) DO UPDATE
           SET role = 'member', status = 'requested', sharing_consent = false,
               invited_by = EXCLUDED.invited_by, joined_at = NULL, updated_at = now()`,
        [convoy.id, userId, invite.created_by],
      );
      const version = await this.bump(tx, convoy.id);
      await this.audit(tx, convoy.id, userId, 'member.requested', userId, { inviteId: invite.id });
      const row = await this.convoyForUser(convoy.id, userId, tx);
      row.version = version;
      return row;
    });

    await this.hub.publish(joined.id, 'convoy.member.updated', {
      convoyId: joined.id,
      userId,
      role: 'member',
      status: 'requested',
      version: joined.version,
    });
    return serializeConvoy(joined);
  }

  async listInvites(convoyId: string, userId: string) {
    const convoy = await this.convoyForUser(convoyId, userId);
    this.requireManager(convoy);
    const rows = await this.db.query<{
      id: string;
      expires_at: Date;
      max_uses: number;
      used_count: number;
      revoked_at: Date | null;
      created_at: Date;
    }>(
      `SELECT id, expires_at, max_uses, used_count, revoked_at, created_at
       FROM convoy_invites WHERE convoy_id = $1 ORDER BY created_at DESC`,
      [convoyId],
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        expiresAt: iso(row.expires_at),
        maxUses: row.max_uses,
        usedCount: row.used_count,
        revokedAt: iso(row.revoked_at),
        createdAt: iso(row.created_at),
      })),
    };
  }

  async createInvite(convoyId: string, userId: string, dto: CreateInviteDto) {
    const convoy = await this.convoyForUser(convoyId, userId);
    this.requireManager(convoy);
    if (['completed', 'cancelled'].includes(convoy.status)) {
      throw new BadRequestException({ code: 'CONVOY_ENDED', title: 'Konvoi sudah berakhir', detail: 'Undangan tidak dapat dibuat untuk konvoi yang sudah selesai.' });
    }
    const invite = await this.db.transaction(async (tx) => {
      const record = await this.createInviteRecord(
        tx,
        convoyId,
        userId,
        dto.expiresInSeconds ?? 86_400,
        dto.maxUses ?? Math.max(1, convoy.capacity - 1),
      );
      await this.audit(tx, convoyId, userId, 'invite.created', null, { inviteId: record.id, maxUses: record.maxUses });
      return record;
    });
    return {
      id: invite.id,
      code: invite.code,
      link: this.inviteLink(invite.code),
      expiresAt: invite.expiresAt.toISOString(),
      maxUses: invite.maxUses,
      usedCount: 0,
    };
  }

  async revokeInvite(convoyId: string, inviteId: string, userId: string) {
    const convoy = await this.convoyForUser(convoyId, userId);
    this.requireManager(convoy);
    const rows = await this.db.query<{ id: string }>(
      `UPDATE convoy_invites SET revoked_at = now(), revoked_by = $3
       WHERE id = $1 AND convoy_id = $2 AND revoked_at IS NULL RETURNING id`,
      [inviteId, convoyId, userId],
    );
    if (!rows[0]) throw new NotFoundException({ code: 'INVITE_NOT_FOUND', title: 'Undangan tidak ditemukan', detail: 'Undangan tidak ada atau sudah dicabut.' });
    await this.audit(this.db, convoyId, userId, 'invite.revoked', null, { inviteId });
    return { id: inviteId, revoked: true };
  }

  async approve(convoyId: string, targetUserId: string, userId: string, ifMatch?: string) {
    const convoy = await this.convoyForUser(convoyId, userId);
    this.requireManager(convoy);
    this.assertVersion(convoy, ifMatch);
    const result = await this.db.transaction(async (tx) => {
      const rows = await tx.query<MemberRow>(
        `SELECT m.*, u.display_name, u.username, u.avatar_url
         FROM convoy_members m JOIN users u ON u.id = m.user_id
         WHERE m.convoy_id = $1 AND m.user_id = $2 FOR UPDATE`,
        [convoyId, targetUserId],
      );
      const member = rows[0];
      if (!member || member.status !== 'requested') {
        throw new BadRequestException({ code: 'JOIN_REQUEST_NOT_FOUND', title: 'Permintaan tidak ditemukan', detail: 'Pengguna tidak memiliki permintaan bergabung yang menunggu.' });
      }
      if ((convoy.active_count ?? 0) >= convoy.capacity) {
        throw new BadRequestException({ code: 'CONVOY_FULL', title: 'Konvoi penuh', detail: 'Kurangi anggota atau selesaikan konvoi sebelum menyetujui permintaan baru.' });
      }
      await tx.query(
        `UPDATE convoy_members SET status = 'active', joined_at = now(), updated_at = now()
         WHERE convoy_id = $1 AND user_id = $2`,
        [convoyId, targetUserId],
      );
      const version = await this.bump(tx, convoyId);
      await this.audit(tx, convoyId, userId, 'member.approved', targetUserId, {});
      return { version, joinedAt: new Date().toISOString(), member };
    });
    await this.hub.publish(convoyId, 'convoy.member.joined', {
      convoyId,
      userId: targetUserId,
      role: 'member',
      joinedAt: result.joinedAt,
      version: result.version,
    });
    return { convoyId, userId: targetUserId, status: 'active', version: result.version };
  }

  async reject(convoyId: string, targetUserId: string, userId: string, ifMatch?: string) {
    const convoy = await this.convoyForUser(convoyId, userId);
    this.requireManager(convoy);
    this.assertVersion(convoy, ifMatch);
    const version = await this.db.transaction(async (tx) => {
      const rows = await tx.query<MemberRow>(
        `SELECT m.*, u.display_name, u.username, u.avatar_url
         FROM convoy_members m JOIN users u ON u.id = m.user_id
         WHERE m.convoy_id = $1 AND m.user_id = $2 FOR UPDATE`,
        [convoyId, targetUserId],
      );
      if (!rows[0] || rows[0].status !== 'requested') {
        throw new BadRequestException({ code: 'JOIN_REQUEST_NOT_FOUND', title: 'Permintaan tidak ditemukan', detail: 'Pengguna tidak memiliki permintaan bergabung yang menunggu.' });
      }
      await tx.query(
        `UPDATE convoy_members SET status = 'removed', updated_at = now() WHERE convoy_id = $1 AND user_id = $2`,
        [convoyId, targetUserId],
      );
      const next = await this.bump(tx, convoyId);
      await this.audit(tx, convoyId, userId, 'member.rejected', targetUserId, {});
      return next;
    });
    await this.hub.publish(convoyId, 'convoy.member.left', { convoyId, userId: targetUserId, reason: 'rejected', version });
    return { convoyId, userId: targetUserId, status: 'removed', version };
  }

  async remove(convoyId: string, targetUserId: string, userId: string, ifMatch?: string) {
    const convoy = await this.convoyForUser(convoyId, userId);
    this.requireManager(convoy);
    this.assertVersion(convoy, ifMatch);
    if (targetUserId === userId) {
      throw new BadRequestException({ code: 'USE_LEAVE', title: 'Gunakan keluar konvoi', detail: 'Gunakan endpoint leave untuk keluar dari konvoi.' });
    }
    const target = await this.db.query<MemberRow>(
      `SELECT m.*, u.display_name, u.username, u.avatar_url
       FROM convoy_members m JOIN users u ON u.id = m.user_id
       WHERE m.convoy_id = $1 AND m.user_id = $2`,
      [convoyId, targetUserId],
    );
    if (!target[0] || target[0].status !== 'active') {
      throw new NotFoundException({ code: 'MEMBER_NOT_FOUND', title: 'Anggota tidak ditemukan', detail: 'Anggota aktif tidak ditemukan pada konvoi ini.' });
    }
    if (target[0].role === 'leader' || (convoy.my_role === 'co_leader' && target[0].role === 'co_leader')) {
      throw new ForbiddenException({ code: 'ROLE_HIERARCHY', title: 'Tidak dapat mengeluarkan anggota', detail: 'Role Anda tidak lebih tinggi dari anggota yang ingin dikeluarkan.' });
    }
    const version = await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE convoy_members SET status = 'removed', updated_at = now() WHERE convoy_id = $1 AND user_id = $2`,
        [convoyId, targetUserId],
      );
      const next = await this.bump(tx, convoyId);
      await this.audit(tx, convoyId, userId, 'member.removed', targetUserId, {});
      return next;
    });
    await this.store.deletePosition(convoyId, targetUserId);
    await this.hub.publish(convoyId, 'convoy.member.left', { convoyId, userId: targetUserId, reason: 'removed', version });
    this.hub.disconnectUser(convoyId, targetUserId);
    return { convoyId, userId: targetUserId, status: 'removed', version };
  }

  async leave(convoyId: string, userId: string, ifMatch?: string) {
    const convoy = await this.convoyForUser(convoyId, userId);
    this.assertVersion(convoy, ifMatch);
    if (convoy.my_status === 'requested') {
      const version = await this.db.transaction(async (tx) => {
        await tx.query(
          `UPDATE convoy_members SET status = 'left', updated_at = now() WHERE convoy_id = $1 AND user_id = $2`,
          [convoyId, userId],
        );
        const next = await this.bump(tx, convoyId);
        await this.audit(tx, convoyId, userId, 'member.request_cancelled', userId, {});
        return next;
      });
      await this.hub.publish(convoyId, 'convoy.member.left', { convoyId, userId, reason: 'request_cancelled', version });
      return { convoyId, userId, status: 'left', version };
    }
    this.requireActive(convoy);

    const result = await this.db.transaction(async (tx) => {
      const others = await tx.query<MemberRow>(
        `SELECT m.*, u.display_name, u.username, u.avatar_url
         FROM convoy_members m JOIN users u ON u.id = m.user_id
         WHERE m.convoy_id = $1 AND m.status = 'active' AND m.user_id <> $2
         ORDER BY CASE m.role WHEN 'co_leader' THEN 0 ELSE 1 END, m.joined_at ASC
         LIMIT 1 FOR UPDATE`,
        [convoyId, userId],
      );
      await tx.query(
        `UPDATE convoy_members SET status = 'left', updated_at = now() WHERE convoy_id = $1 AND user_id = $2`,
        [convoyId, userId],
      );
      let promoted: string | null = null;
      let terminal = false;
      if (convoy.my_role === 'leader') {
        if (others[0]) {
          promoted = others[0].user_id;
          await tx.query(
            `UPDATE convoy_members SET role = 'leader', updated_at = now() WHERE convoy_id = $1 AND user_id = $2`,
            [convoyId, promoted],
          );
          await tx.query(
            `UPDATE convoys SET leader_id = $2, updated_at = now() WHERE id = $1`,
            [convoyId, promoted],
          );
        } else {
          terminal = true;
          await tx.query(
            `UPDATE convoys SET status = 'cancelled', cancelled_at = now(), updated_at = now() WHERE id = $1`,
            [convoyId],
          );
          await tx.query(
            `UPDATE convoy_members SET status = 'removed', updated_at = now()
             WHERE convoy_id = $1 AND status = 'requested'`,
            [convoyId],
          );
        }
      }
      const version = await this.bump(tx, convoyId);
      await this.audit(tx, convoyId, userId, 'member.left', userId, { promotedUserId: promoted, terminal });
      return { version, promoted, terminal };
    });

    await this.store.deletePosition(convoyId, userId);
    await this.store.deletePresence(convoyId, userId);
    if (result.promoted) {
      await this.hub.publish(convoyId, 'convoy.member.updated', {
        convoyId,
        userId: result.promoted,
        role: 'leader',
        status: 'active',
        previousLeaderId: userId,
        version: result.version,
      });
    }
    if (result.terminal) {
      await this.hub.publish(convoyId, 'convoy.status.changed', {
        convoyId,
        status: 'cancelled',
        actorId: userId,
        version: result.version,
      });
    } else {
      await this.hub.publish(convoyId, 'convoy.member.left', { convoyId, userId, reason: 'left', version: result.version });
    }
    this.hub.disconnectUser(convoyId, userId);
    if (result.terminal) this.hub.closeConvoy(convoyId);
    return { convoyId, userId, status: 'left', promotedUserId: result.promoted, convoyStatus: result.terminal ? 'cancelled' : convoy.status, version: result.version };
  }

  async changeRole(convoyId: string, targetUserId: string, userId: string, dto: ChangeMemberRoleDto, ifMatch?: string) {
    const convoy = await this.convoyForUser(convoyId, userId);
    this.requireLeader(convoy);
    this.assertVersion(convoy, ifMatch);
    if (targetUserId === userId) {
      throw new BadRequestException({ code: 'ROLE_SELF_CHANGE', title: 'Tidak dapat mengubah role sendiri', detail: 'Gunakan transfer kepemimpinan untuk memindahkan role leader.' });
    }
    const version = await this.db.transaction(async (tx) => {
      const rows = await tx.query<MemberRow>(
        `SELECT m.*, u.display_name, u.username, u.avatar_url
         FROM convoy_members m JOIN users u ON u.id = m.user_id
         WHERE m.convoy_id = $1 AND m.user_id = $2 AND m.status = 'active' FOR UPDATE`,
        [convoyId, targetUserId],
      );
      if (!rows[0]) throw new NotFoundException({ code: 'MEMBER_NOT_FOUND', title: 'Anggota tidak ditemukan', detail: 'Anggota aktif tidak ditemukan.' });
      await tx.query(
        `UPDATE convoy_members SET role = $3, updated_at = now() WHERE convoy_id = $1 AND user_id = $2`,
        [convoyId, targetUserId, dto.role],
      );
      const next = await this.bump(tx, convoyId);
      await this.audit(tx, convoyId, userId, 'member.role_changed', targetUserId, { role: dto.role });
      return next;
    });
    await this.hub.publish(convoyId, 'convoy.member.updated', {
      convoyId,
      userId: targetUserId,
      role: dto.role,
      status: 'active',
      version,
    });
    return { convoyId, userId: targetUserId, role: dto.role, version };
  }

  async transferLeadership(convoyId: string, userId: string, targetUserId: string, ifMatch?: string) {
    const convoy = await this.convoyForUser(convoyId, userId);
    this.requireLeader(convoy);
    this.assertVersion(convoy, ifMatch);
    if (targetUserId === userId) {
      throw new BadRequestException({ code: 'TRANSFER_SELF', title: 'Target tidak valid', detail: 'Pilih anggota lain sebagai leader.' });
    }
    const version = await this.db.transaction(async (tx) => {
      const target = await tx.query<MemberRow>(
        `SELECT m.*, u.display_name, u.username, u.avatar_url
         FROM convoy_members m JOIN users u ON u.id = m.user_id
         WHERE m.convoy_id = $1 AND m.user_id = $2 AND m.status = 'active' FOR UPDATE`,
        [convoyId, targetUserId],
      );
      if (!target[0]) throw new NotFoundException({ code: 'MEMBER_NOT_FOUND', title: 'Anggota tidak ditemukan', detail: 'Anggota aktif tidak ditemukan.' });
      await tx.query(
        `UPDATE convoy_members SET role = 'co_leader', updated_at = now() WHERE convoy_id = $1 AND user_id = $2`,
        [convoyId, userId],
      );
      await tx.query(
        `UPDATE convoy_members SET role = 'leader', updated_at = now() WHERE convoy_id = $1 AND user_id = $2`,
        [convoyId, targetUserId],
      );
      await tx.query('UPDATE convoys SET leader_id = $2, updated_at = now() WHERE id = $1', [convoyId, targetUserId]);
      const next = await this.bump(tx, convoyId);
      await this.audit(tx, convoyId, userId, 'leadership.transferred', targetUserId, {});
      return next;
    });
    await this.hub.publish(convoyId, 'convoy.member.updated', {
      convoyId,
      userId: targetUserId,
      role: 'leader',
      status: 'active',
      previousLeaderId: userId,
      version,
    });
    return { convoyId, leaderId: targetUserId, previousLeaderId: userId, version };
  }

  async updateSharing(convoyId: string, userId: string, sharingConsent: boolean) {
    const convoy = await this.convoyForUser(convoyId, userId);
    this.requireActive(convoy);
    const version = await this.db.transaction(async (tx) => {
      await tx.query(
        `UPDATE convoy_members SET sharing_consent = $3, updated_at = now() WHERE convoy_id = $1 AND user_id = $2`,
        [convoyId, userId, sharingConsent],
      );
      const next = await this.bump(tx, convoyId);
      await this.audit(tx, convoyId, userId, 'location.consent_changed', userId, { sharingConsent });
      return next;
    });
    if (!sharingConsent) {
      await this.store.deletePosition(convoyId, userId);
      await this.store.deletePresence(convoyId, userId);
    }
    await this.hub.publish(convoyId, 'convoy.member.updated', {
      convoyId,
      userId,
      role: convoy.my_role,
      status: 'active',
      sharingConsent,
      version,
    });
    if (!sharingConsent) {
      await this.hub.publish(convoyId, 'convoy.location.stale', {
        convoyId,
        userId,
        lastSeenAt: null,
        reason: 'sharing_disabled',
        version,
      });
    }
    return { convoyId, userId, sharingConsent, version };
  }

  async updateRoute(convoyId: string, userId: string, dto: UpdateConvoyRouteDto, ifMatch?: string) {
    const convoy = await this.convoyForUser(convoyId, userId);
    this.requireManager(convoy);
    this.assertVersion(convoy, ifMatch);
    if (['completed', 'cancelled', 'draft'].includes(convoy.status)) {
      throw new BadRequestException({ code: 'CONVOY_NOT_ROUTABLE', title: 'Rute tidak dapat diubah', detail: 'Rute hanya dapat diperbarui pada konvoi lobby, aktif, atau jeda.' });
    }
    const route = await this.db.query<{ id: string }>('SELECT id FROM routes WHERE id = $1 AND owner_id = $2', [dto.routeId, userId]);
    if (!route[0]) throw new NotFoundException({ code: 'ROUTE_NOT_FOUND', title: 'Rute tidak ditemukan', detail: 'Rute tidak tersedia untuk akun ini.' });
    const result = await this.db.transaction(async (tx) => {
      const rows = await tx.query<{ route_version: number; version: number }>(
        `UPDATE convoys SET route_id = $2, route_version = route_version + 1, version = version + 1, updated_at = now()
         WHERE id = $1 RETURNING route_version, version`,
        [convoyId, dto.routeId],
      );
      await this.audit(tx, convoyId, userId, 'route.updated', null, { routeId: dto.routeId, routeVersion: rows[0].route_version });
      return rows[0];
    });
    await this.hub.publish(convoyId, 'convoy.route.updated', {
      convoyId,
      routeId: dto.routeId,
      routeVersion: result.route_version,
      changedBy: userId,
      version: result.version,
    });
    return { convoyId, routeId: dto.routeId, routeVersion: result.route_version, version: result.version };
  }

  async transition(
    convoyId: string,
    userId: string,
    target: 'lobby' | 'active' | 'paused' | 'completed' | 'cancelled',
    ifMatch?: string,
  ) {
    const convoy = await this.convoyForUser(convoyId, userId);
    this.requireLeader(convoy);
    this.assertVersion(convoy, ifMatch);
    if (!canTransition(convoy.status, target)) {
      throw new BadRequestException({
        code: 'INVALID_CONVOY_TRANSITION',
        title: 'Perubahan status tidak valid',
        detail: `Konvoi berstatus ${convoy.status} tidak dapat berpindah ke ${target}.`,
      });
    }
    if (target === 'active' && (convoy.active_count ?? 0) > convoy.capacity) {
      throw new BadRequestException({ code: 'CONVOY_OVER_CAPACITY', title: 'Kapasitas terlampaui', detail: 'Jumlah anggota aktif melebihi kapasitas konvoi.' });
    }
    const terminal = target === 'completed' || target === 'cancelled';
    const result = await this.db.transaction(async (tx) => {
      const timestampColumn = target === 'completed' ? 'completed_at' : target === 'cancelled' ? 'cancelled_at' : target === 'paused' ? 'paused_at' : null;
      const fields = ['status = $2', 'version = version + 1', 'updated_at = now()'];
      if (target === 'active') fields.push('started_at = COALESCE(started_at, now())', 'paused_at = NULL');
      if (timestampColumn) fields.push(`${timestampColumn} = now()`);
      const rows = await tx.query<{ version: number }>(
        `UPDATE convoys SET ${fields.join(', ')} WHERE id = $1 RETURNING version`,
        [convoyId, target],
      );
      if (terminal) {
        await tx.query(
          `UPDATE convoy_members SET status = 'left', updated_at = now()
           WHERE convoy_id = $1 AND status IN ('active', 'requested')`,
          [convoyId],
        );
      }
      await this.audit(tx, convoyId, userId, `status.${target}`, null, { from: convoy.status, to: target });
      return rows[0];
    });

    await this.hub.publish(convoyId, 'convoy.status.changed', {
      convoyId,
      status: target,
      actorId: userId,
      version: result.version,
    });
    if (terminal) {
      await this.store.clearConvoy(convoyId);
      this.hub.closeConvoy(convoyId);
    }
    return { convoyId, status: target, version: result.version };
  }

  async positions(convoyId: string, userId: string) {
    const convoy = await this.convoyForUser(convoyId, userId);
    this.requireVisible(convoy);
    if (convoy.my_status !== 'active') {
      return { items: [], serverTime: new Date().toISOString() };
    }
    const members = await this.db.query<{ user_id: string; sharing_consent: boolean }>(
      `SELECT user_id, sharing_consent FROM convoy_members WHERE convoy_id = $1 AND status = 'active'`,
      [convoyId],
    );
    const sharing = new Set(members.filter((member) => member.sharing_consent).map((member) => member.user_id));
    const stored = await this.store.getPositions(convoyId);
    const now = Date.now();
    return {
      items: stored
        .filter((position) => sharing.has(position.userId))
        .map((position) => this.serializePosition(position, now)),
      serverTime: new Date(now).toISOString(),
    };
  }

  serializePosition(position: StoredPosition, now = Date.now()) {
    const ageSeconds = Math.max(0, Math.floor((now - new Date(position.lastSeenAt).getTime()) / 1000));
    return {
      userId: position.userId,
      lat: position.lat,
      lng: position.lng,
      accuracyM: position.accuracyM,
      headingDeg: position.headingDeg,
      speedMps: position.speedMps,
      recordedAt: position.recordedAt,
      lastSeenAt: position.lastSeenAt,
      stale: ageSeconds > this.config.staleAfterSeconds,
      ageSeconds,
    };
  }
}
