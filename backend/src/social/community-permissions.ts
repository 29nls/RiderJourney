import type { Database } from '../db/database.js';

export type CommunityPermission =
  | 'post.create' | 'post.remove_any' | 'comment.remove_any'
  | 'member.approve' | 'member.remove' | 'member.ban' | 'member.set_role'
  | 'event.publish' | 'album.create' | 'community.settings';

/**
 * The owner always holds every permission, so a club can never lock itself out
 * of management. Every other role must both be an active member and have an
 * explicit grant in the per-community matrix; a missing row denies by default.
 */
export async function communityPermission(
  db: Database,
  communityId: string,
  userId: string,
  permission: CommunityPermission,
): Promise<{ allowed: boolean; role: string | null; blocked: boolean }> {
  const rows = await db.query<{ role: string; status: string; blocked: boolean }>(
    `SELECT m.role, m.status,
            EXISTS (SELECT 1 FROM user_blocks b WHERE b.blocker_id = m.user_id AND b.blocked_id = $2) AS blocked
     FROM community_members m
     WHERE m.community_id = $1 AND m.user_id = $2`,
    [communityId, userId],
  );
  const membership = rows[0];
  if (!membership || membership.status !== 'active') return { allowed: false, role: null, blocked: membership?.blocked ?? false };
  if (membership.role === 'owner') return { allowed: true, role: 'owner', blocked: membership.blocked };
  const grants = await db.query<{ permission: string }>(
    `SELECT permission FROM community_role_permissions
     WHERE community_id = $1 AND role = $2 AND permission = $3`,
    [communityId, membership.role, permission],
  );
  return { allowed: grants.length > 0, role: membership.role, blocked: membership.blocked };
}
