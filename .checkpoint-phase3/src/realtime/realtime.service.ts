import { ForbiddenException, HttpException, HttpStatus, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { randomBytes } from 'node:crypto';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.js';
import { sha256 } from '../common/crypto.js';
import { REALTIME_STORE, type RealtimeStore } from './realtime.store.js';
import type { RealtimeTicket, StoredPosition } from './realtime.types.js';

export type ActiveMemberAccess = {
  role: 'leader' | 'co_leader' | 'member';
  sharingConsent: boolean;
  convoyStatus: string;
};

type SnapshotMember = {
  user_id: string;
  display_name: string;
  username: string;
  role: 'leader' | 'co_leader' | 'member';
  status: string;
  sharing_consent: boolean;
  last_seen_at: Date | null;
};

@Injectable()
export class RealtimeService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    @Inject(REALTIME_STORE) private readonly store: RealtimeStore,
  ) {}

  async activeMember(convoyId: string, userId: string): Promise<ActiveMemberAccess> {
    const rows = await this.db.query<{ role: 'leader' | 'co_leader' | 'member'; sharing_consent: boolean; status: string }>(
      `SELECT m.role, m.sharing_consent, c.status
       FROM convoys c JOIN convoy_members m ON m.convoy_id = c.id
       WHERE c.id = $1 AND m.user_id = $2 AND m.status = 'active'`,
      [convoyId, userId],
    );
    if (!rows[0]) {
      throw new ForbiddenException({
        code: 'CONVOY_ACCESS_DENIED',
        title: 'Akses realtime ditolak',
        detail: 'Anda bukan anggota aktif konvoi ini.',
      });
    }
    return { role: rows[0].role, sharingConsent: rows[0].sharing_consent, convoyStatus: rows[0].status };
  }

  async issueTicket(userId: string, convoyId: string) {
    const limit = await this.store.incrementRateLimit(`ticket:${userId}`, 60);
    if (limit > 20) {
      throw new HttpException(
        {
          code: 'TICKET_RATE_LIMITED',
          title: 'Terlalu banyak permintaan tiket',
          detail: 'Tunggu satu menit sebelum meminta tiket realtime lagi.',
          retryAfterSeconds: 60,
        },
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }
    const access = await this.activeMember(convoyId, userId);
    if (!['lobby', 'active', 'paused'].includes(access.convoyStatus)) {
      throw new ForbiddenException({
        code: 'CONVOY_NOT_LIVE',
        title: 'Konvoi tidak menerima koneksi',
        detail: 'Realtime hanya tersedia pada konvoi lobby, aktif, atau jeda.',
      });
    }

    const raw = randomBytes(32).toString('base64url');
    const ticket: RealtimeTicket = {
      hash: sha256(raw),
      userId,
      convoyId,
      role: access.role,
      capabilities: {
        subscribe: true,
        publishLocation: access.convoyStatus === 'active' && access.sharingConsent,
      },
      expiresAt: Date.now() + this.config.realtimeTicketTtlSeconds * 1000,
    };
    await this.store.saveTicket(ticket, this.config.realtimeTicketTtlSeconds);
    return {
      ticket: raw,
      expiresIn: this.config.realtimeTicketTtlSeconds,
      convoyId,
      protocol: 'v1',
      wsPath: '/v1/realtime',
      capabilities: ticket.capabilities,
    };
  }

  async snapshot(convoyId: string, userId: string) {
    const rows = await this.db.query<{
      id: string;
      status: string;
      version: number;
      route_id: string | null;
      route_version: number;
      role: 'leader' | 'co_leader' | 'member';
      sharing_consent: boolean;
    }>(
      `SELECT c.id, c.status, c.version, c.route_id, c.route_version, m.role, m.sharing_consent
       FROM convoys c JOIN convoy_members m ON m.convoy_id = c.id
       WHERE c.id = $1 AND m.user_id = $2 AND m.status = 'active'`,
      [convoyId, userId],
    );
    const convoy = rows[0];
    if (!convoy) {
      throw new NotFoundException({ code: 'CONVOY_NOT_FOUND', title: 'Konvoi tidak ditemukan', detail: 'Keanggotaan aktif tidak ditemukan.' });
    }
    const members = await this.db.query<SnapshotMember>(
      `SELECT m.user_id, u.display_name, u.username, m.role, m.status, m.sharing_consent, m.last_seen_at
       FROM convoy_members m JOIN users u ON u.id = m.user_id
       WHERE m.convoy_id = $1 AND m.status = 'active'
       ORDER BY CASE m.role WHEN 'leader' THEN 0 WHEN 'co_leader' THEN 1 ELSE 2 END, m.joined_at NULLS LAST`,
      [convoyId],
    );
    const sharing = new Set(members.filter((member) => member.sharing_consent).map((member) => member.user_id));
    const positions = (await this.store.getPositions(convoyId))
      .filter((position) => sharing.has(position.userId))
      .map((position) => this.position(position));
    const online = new Set((await this.store.getPresence(convoyId)).map((presence) => presence.userId));
    const byUser = new Map(positions.map((position) => [position.userId, position]));
    const last = await this.store.eventsSince(convoyId, 0, 1);
    return {
      convoyId,
      status: convoy.status,
      version: convoy.version,
      role: convoy.role,
      sharingConsent: convoy.sharing_consent,
      members: members.map((member) => {
        const position = byUser.get(member.user_id);
        return {
          userId: member.user_id,
          displayName: member.display_name,
          username: member.username,
          role: member.role,
          status: member.status,
          sharingConsent: member.sharing_consent,
          presence: online.has(member.user_id) ? 'online' : 'offline',
          locationStatus: position ? (position.stale ? 'stale' : 'live') : member.sharing_consent ? 'waiting' : 'not_sharing',
          lastSeenAt: member.last_seen_at ? new Date(member.last_seen_at).toISOString() : null,
        };
      }),
      positions,
      routeId: convoy.route_id,
      routeVersion: convoy.route_version,
      lastSeq: last[0]?.seq ?? 0,
      serverTime: new Date().toISOString(),
    };
  }

  position(position: StoredPosition) {
    const ageSeconds = Math.max(0, Math.floor((Date.now() - new Date(position.lastSeenAt).getTime()) / 1000));
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
