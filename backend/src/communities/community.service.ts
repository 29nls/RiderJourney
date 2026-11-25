import {
  ConflictException, ForbiddenException, Inject, Injectable, NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { DATABASE, type Database } from '../db/database.js';
import { isUniqueViolation } from '../common/db-errors.js';
import { communityPermission, type CommunityPermission } from '../social/community-permissions.js';
import type { CreateCommunityDto, SetCommunityRoleDto } from './community.dto.js';

type CommunityRow = {
  id: string;
  slug: string;
  name: string;
  description: string | null;
  region: string | null;
  visibility: string;
  owner_id: string;
  created_at: Date;
  owner_username: string;
  owner_display_name: string;
  member_count: number;
  viewer_status: string | null;
  viewer_role: string | null;
  viewer_joined_at: Date | null;
};

type MembershipRow = {
  user_id: string;
  role: string;
  status: string;
  joined_at: Date | null;
};

const DEFAULT_PERMISSIONS: Array<{
  role: 'admin' | 'moderator' | 'member';
  permission: CommunityPermission;
}> = [
  { role: 'member', permission: 'post.create' },
  { role: 'member', permission: 'album.create' },
  { role: 'moderator', permission: 'post.create' },
  { role: 'moderator', permission: 'album.create' },
  { role: 'moderator', permission: 'post.remove_any' },
  { role: 'moderator', permission: 'comment.remove_any' },
  { role: 'moderator', permission: 'member.approve' },
  { role: 'moderator', permission: 'member.remove' },
  { role: 'moderator', permission: 'event.publish' },
  { role: 'admin', permission: 'post.create' },
  { role: 'admin', permission: 'album.create' },
  { role: 'admin', permission: 'post.remove_any' },
  { role: 'admin', permission: 'comment.remove_any' },
  { role: 'admin', permission: 'member.approve' },
  { role: 'admin', permission: 'member.remove' },
  { role: 'admin', permission: 'member.ban' },
  { role: 'admin', permission: 'member.set_role' },
  { role: 'admin', permission: 'event.publish' },
  { role: 'admin', permission: 'community.settings' },
];

@Injectable()
export class CommunityService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  private async audit(
    tx: Database,
    communityId: string,
    actorId: string,
    action: string,
    targetUserId: string | null,
    metadata: Record<string, unknown>,
  ): Promise<void> {
    await tx.query(
      `INSERT INTO community_audit_logs (id, community_id, actor_id, action, target_user_id, metadata)
       VALUES ($1, $2, $3, $4, $5, $6::jsonb)`,
      [uuidv7(), communityId, actorId, action, targetUserId, JSON.stringify(metadata)],
    );
  }

  private presentCommunity(row: CommunityRow) {
    return {
      id: row.id,
      slug: row.slug,
      name: row.name,
      description: row.description,
      region: row.region,
      visibility: row.visibility,
      owner: {
        id: row.owner_id,
        username: row.owner_username,
        displayName: row.owner_display_name,
      },
      memberCount: Number(row.member_count),
      viewerMembership: row.viewer_status
        ? {
            status: row.viewer_status,
            role: row.viewer_role,
            joinedAt: row.viewer_joined_at ? new Date(row.viewer_joined_at).toISOString() : null,
          }
        : null,
      createdAt: new Date(row.created_at).toISOString(),
    };
  }

  async create(userId: string, dto: CreateCommunityDto) {
    const slug = dto.slug.trim().toLowerCase();
    const name = dto.name.trim();
    if (!name) {
      throw new UnprocessableEntityException({
        code: 'COMMUNITY_NAME_REQUIRED',
        title: 'Nama komunitas wajib diisi',
        detail: 'Nama tidak boleh hanya berisi spasi.',
      });
    }
    const visibility = dto.visibility ?? 'public';
    const existing = await this.db.query<{ id: string }>(
      `SELECT id FROM communities WHERE lower(slug) = $1`,
      [slug],
    );
    if (existing[0]) {
      throw new ConflictException({
        code: 'COMMUNITY_SLUG_TAKEN',
        title: 'Slug komunitas sudah dipakai',
        detail: 'Pilih slug lain.',
      });
    }

    const id = uuidv7();
    try {
      await this.db.transaction(async (tx) => {
        await tx.query(
          `INSERT INTO communities (id, slug, name, description, region, visibility, owner_id)
           VALUES ($1, $2, $3, $4, $5, $6, $7)`,
          [id, slug, name, dto.description?.trim() || null, dto.region?.trim() || null, visibility, userId],
        );
        await tx.query(
          `INSERT INTO community_policies (community_id, join_policy) VALUES ($1, $2)`,
          [id, visibility === 'private' ? 'request' : 'open'],
        );
        await tx.query(
          `INSERT INTO community_members (community_id, user_id, role, status, joined_at)
           VALUES ($1, $2, 'owner', 'active', now())`,
          [id, userId],
        );
        for (const grant of DEFAULT_PERMISSIONS) {
          await tx.query(
            `INSERT INTO community_role_permissions (community_id, role, permission, granted_by)
             VALUES ($1, $2, $3, $4)`,
            [id, grant.role, grant.permission, userId],
          );
        }
        await this.audit(tx, id, userId, 'community.create', userId, {
          slug,
          visibility,
        });
      });
    } catch (error) {
      if (isUniqueViolation(error)) {
        throw new ConflictException({
          code: 'COMMUNITY_SLUG_TAKEN',
          title: 'Slug komunitas sudah dipakai',
          detail: 'Pilih slug lain.',
        });
      }
      throw error;
    }
    return this.detail(userId, id);
  }

  async detail(viewerId: string, communityId: string) {
    const rows = await this.db.query<CommunityRow>(
      `SELECT c.id, c.slug, c.name, c.description, c.region, c.visibility, c.owner_id,
              c.created_at, u.username AS owner_username, u.display_name AS owner_display_name,
              (SELECT count(*)::int FROM community_members cm
                WHERE cm.community_id = c.id AND cm.status = 'active') AS member_count,
              m.status AS viewer_status, m.role AS viewer_role, m.joined_at AS viewer_joined_at
       FROM communities c
       JOIN users u ON u.id = c.owner_id
       LEFT JOIN community_members m ON m.community_id = c.id AND m.user_id = $2
       WHERE c.id = $1 AND c.moderation_status = 'visible'`,
      [communityId, viewerId],
    );
    if (!rows[0]) {
      throw new NotFoundException({
        code: 'COMMUNITY_NOT_FOUND',
        title: 'Komunitas tidak ditemukan',
        detail: 'Komunitas tidak tersedia.',
      });
    }
    return this.presentCommunity(rows[0]);
  }

  async join(userId: string, communityId: string) {
    const outcome = await this.db.transaction(async (tx) => {
      const communities = await tx.query<{ id: string; visibility: string; join_policy: string | null }>(
        `SELECT c.id, c.visibility, p.join_policy
         FROM communities c LEFT JOIN community_policies p ON p.community_id = c.id
         WHERE c.id = $1 AND c.moderation_status = 'visible'`,
        [communityId],
      );
      const community = communities[0];
      if (!community) {
        throw new NotFoundException({
          code: 'COMMUNITY_NOT_FOUND',
          title: 'Komunitas tidak ditemukan',
          detail: 'Komunitas tidak tersedia.',
        });
      }

      const current = await tx.query<MembershipRow>(
        `SELECT user_id, role, status, joined_at FROM community_members
         WHERE community_id = $1 AND user_id = $2 FOR UPDATE`,
        [communityId, userId],
      );
      const membership = current[0];
      if (membership?.status === 'banned') {
        throw new ForbiddenException({
          code: 'COMMUNITY_BANNED',
          title: 'Tidak dapat bergabung',
          detail: 'Akun ini dilarang bergabung dengan komunitas tersebut.',
        });
      }
      if (membership?.status === 'active' || membership?.status === 'requested') {
        return {
          status: membership.status,
          role: membership.role,
          joinedAt: membership.joined_at ? new Date(membership.joined_at).toISOString() : null,
          duplicate: true,
        };
      }

      const open = community.visibility === 'public' && community.join_policy === 'open';
      const status = open ? 'active' : 'requested';
      const updated = await tx.query<MembershipRow>(
        `UPDATE community_members
         SET status = $3, role = 'member', joined_at = CASE WHEN $3 = 'active' THEN now() ELSE NULL END,
             role_changed_at = now(), updated_at = now()
         WHERE community_id = $1 AND user_id = $2 AND status IN ('left', 'removed')
         RETURNING user_id, role, status, joined_at`,
        [communityId, userId, status],
      );
      let joined = updated[0];
      if (!joined) {
        const inserted = await tx.query<MembershipRow>(
          `INSERT INTO community_members (community_id, user_id, role, status, joined_at)
           VALUES ($1, $2, 'member', $3, CASE WHEN $3 = 'active' THEN now() ELSE NULL END)
           ON CONFLICT (community_id, user_id) DO NOTHING
           RETURNING user_id, role, status, joined_at`,
          [communityId, userId, status],
        );
        joined = inserted[0];
      }
      if (!joined) {
        const raced = await tx.query<MembershipRow>(
          `SELECT user_id, role, status, joined_at FROM community_members
           WHERE community_id = $1 AND user_id = $2`,
          [communityId, userId],
        );
        const row = raced[0];
        if (!row || row.status === 'banned') {
          throw new ForbiddenException({
            code: 'COMMUNITY_BANNED',
            title: 'Tidak dapat bergabung',
            detail: 'Akun ini dilarang bergabung dengan komunitas tersebut.',
          });
        }
        return {
          status: row.status,
          role: row.role,
          joinedAt: row.joined_at ? new Date(row.joined_at).toISOString() : null,
          duplicate: true,
        };
      }
      await this.audit(tx, communityId, userId, open ? 'member.join' : 'member.request', userId, {
        status,
      });
      return {
        status: joined.status,
        role: joined.role,
        joinedAt: joined.joined_at ? new Date(joined.joined_at).toISOString() : null,
        duplicate: false,
      };
    });
    return { communityId, ...outcome };
  }

  private async requirePermission(userId: string, communityId: string, permission: CommunityPermission) {
    const communities = await this.db.query<{ id: string }>(
      `SELECT id FROM communities WHERE id = $1 AND moderation_status = 'visible'`,
      [communityId],
    );
    if (!communities[0]) {
      throw new NotFoundException({
        code: 'COMMUNITY_NOT_FOUND',
        title: 'Komunitas tidak ditemukan',
        detail: 'Komunitas tidak tersedia.',
      });
    }
    const access = await communityPermission(this.db, communityId, userId, permission);
    if (!access.allowed) {
      throw new ForbiddenException({
        code: 'COMMUNITY_PERMISSION_DENIED',
        title: 'Izin komunitas tidak cukup',
        detail: `Peran komunitas tidak memiliki izin ${permission}.`,
      });
    }
  }

  private async requireMember(userId: string, communityId: string) {
    const rows = await this.db.query<{ role: string }>(
      `SELECT role FROM community_members
       WHERE community_id = $1 AND user_id = $2 AND status = 'active'`,
      [communityId, userId],
    );
    if (!rows[0]) {
      throw new NotFoundException({
        code: 'COMMUNITY_NOT_FOUND',
        title: 'Komunitas tidak ditemukan',
        detail: 'Komunitas hanya tersedia untuk anggota aktif.',
      });
    }
  }

  async members(userId: string, communityId: string) {
    await this.requireMember(userId, communityId);
    const rows = await this.db.query<{
      id: string; username: string; display_name: string; role: string; joined_at: Date | null;
    }>(
      `SELECT u.id, u.username, u.display_name, m.role, m.joined_at
       FROM community_members m JOIN users u ON u.id = m.user_id
       WHERE m.community_id = $1 AND m.status = 'active'
       ORDER BY CASE m.role
         WHEN 'owner' THEN 0 WHEN 'admin' THEN 1 WHEN 'moderator' THEN 2 ELSE 3 END,
         u.username
       LIMIT 200`,
      [communityId],
    );
    return {
      items: rows.map((row) => ({
        id: row.id,
        username: row.username,
        displayName: row.display_name,
        role: row.role,
        joinedAt: row.joined_at ? new Date(row.joined_at).toISOString() : null,
      })),
    };
  }

  async joinRequests(actorId: string, communityId: string) {
    await this.requirePermission(actorId, communityId, 'member.approve');
    const rows = await this.db.query<{
      id: string; username: string; display_name: string; created_at: Date;
    }>(
      `SELECT u.id, u.username, u.display_name, m.created_at
       FROM community_members m JOIN users u ON u.id = m.user_id
       WHERE m.community_id = $1 AND m.status = 'requested'
       ORDER BY m.created_at ASC, u.username
       LIMIT 200`,
      [communityId],
    );
    return {
      items: rows.map((row) => ({
        userId: row.id,
        username: row.username,
        displayName: row.display_name,
        requestedAt: new Date(row.created_at).toISOString(),
      })),
    };
  }

  private async decideRequest(actorId: string, communityId: string, targetUserId: string, approve: boolean) {
    await this.requirePermission(actorId, communityId, 'member.approve');
    return this.db.transaction(async (tx) => {
      const rows = await tx.query<MembershipRow>(
        `UPDATE community_members
         SET status = $3, joined_at = CASE WHEN $3 = 'active' THEN now() ELSE NULL END,
             updated_at = now()
         WHERE community_id = $1 AND user_id = $2 AND status = 'requested'
         RETURNING user_id, role, status, joined_at`,
        [communityId, targetUserId, approve ? 'active' : 'left'],
      );
      const membership = rows[0];
      if (!membership) {
        throw new NotFoundException({
          code: 'JOIN_REQUEST_NOT_FOUND',
          title: 'Permintaan bergabung tidak ditemukan',
          detail: 'Permintaan sudah diproses atau tidak ada.',
        });
      }
      await this.audit(tx, communityId, actorId, approve ? 'member.approve' : 'member.decline', targetUserId, {
        status: membership.status,
      });
      return {
        communityId,
        userId: targetUserId,
        status: membership.status,
        role: membership.role,
        joinedAt: membership.joined_at ? new Date(membership.joined_at).toISOString() : null,
        approved: approve,
      };
    });
  }

  approve(actorId: string, communityId: string, targetUserId: string) {
    return this.decideRequest(actorId, communityId, targetUserId, true);
  }

  decline(actorId: string, communityId: string, targetUserId: string) {
    return this.decideRequest(actorId, communityId, targetUserId, false);
  }

  async setRole(actorId: string, communityId: string, targetUserId: string, dto: SetCommunityRoleDto) {
    await this.requirePermission(actorId, communityId, 'member.set_role');
    return this.db.transaction(async (tx) => {
      const rows = await tx.query<MembershipRow>(
        `SELECT user_id, role, status, joined_at FROM community_members
         WHERE community_id = $1 AND user_id = $2 FOR UPDATE`,
        [communityId, targetUserId],
      );
      const membership = rows[0];
      if (!membership || membership.status !== 'active') {
        throw new NotFoundException({
          code: 'COMMUNITY_MEMBER_NOT_FOUND',
          title: 'Anggota tidak ditemukan',
          detail: 'Hanya anggota aktif yang dapat diubah perannya.',
        });
      }
      if (membership.role === 'owner') {
        throw new ForbiddenException({
          code: 'OWNER_ROLE_IMMUTABLE',
          title: 'Peran owner tidak dapat diubah',
          detail: 'Kepemilikan komunitas tidak dapat dipindahkan lewat endpoint ini.',
        });
      }
      if (targetUserId === actorId) {
        throw new ForbiddenException({
          code: 'SELF_ROLE_CHANGE',
          title: 'Tidak dapat mengubah peran sendiri',
          detail: 'Minta pengurus lain mengubah peran akun ini.',
        });
      }
      if (membership.role === dto.role) {
        return {
          communityId,
          userId: targetUserId,
          role: membership.role,
          duplicate: true,
        };
      }
      await tx.query(
        `UPDATE community_members
         SET role = $3, role_changed_at = now(), updated_at = now()
         WHERE community_id = $1 AND user_id = $2`,
        [communityId, targetUserId, dto.role],
      );
      await this.audit(tx, communityId, actorId, 'member.role', targetUserId, {
        before: membership.role,
        after: dto.role,
      });
      return {
        communityId,
        userId: targetUserId,
        role: dto.role,
        duplicate: false,
      };
    });
  }
}
