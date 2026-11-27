export type AdminRole = 'support' | 'moderator' | 'admin' | 'superadmin';

export type AdminActor = {
  userId: string;
  role: AdminRole;
};

export type AdminPermission =
  | 'dashboard.read' | 'users.read' | 'users.suspend' | 'users.ban'
  | 'reports.read' | 'reports.act' | 'posts.read' | 'posts.moderate'
  | 'communities.read' | 'communities.moderate' | 'subscriptions.read'
  | 'subscriptions.manage' | 'redeem.manage' | 'config.read' | 'config.write'
  | 'audit.read' | 'jobs.run' | 'billing.reconcile'
  | 'media.read' | 'media.moderate' | 'media.ops';

const SUPPORT: AdminPermission[] = ['dashboard.read', 'users.read', 'reports.read', 'subscriptions.read', 'audit.read'];
const MODERATOR: AdminPermission[] = [
  ...SUPPORT, 'users.suspend', 'reports.act', 'posts.read', 'posts.moderate',
  'communities.read', 'communities.moderate', 'media.read', 'media.moderate',
];
const ADMIN: AdminPermission[] = [
  ...MODERATOR, 'users.ban', 'subscriptions.manage', 'redeem.manage',
  'config.read', 'config.write', 'jobs.run', 'billing.reconcile', 'media.ops',
];

export function hasPermission(role: AdminRole, permission: AdminPermission): boolean {
  if (role === 'superadmin') return true;
  const granted = role === 'admin' ? ADMIN : role === 'moderator' ? MODERATOR : SUPPORT;
  return granted.includes(permission);
}
