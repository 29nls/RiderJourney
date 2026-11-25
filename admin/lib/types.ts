export type AdminSession = {
  userId: string;
  role: 'support' | 'moderator' | 'admin' | 'superadmin';
  permissions: string[];
  mfa: { enrolled: boolean; stepUpTtlSeconds: number };
};

export type RunAction = <T>(action: (stepUp: string) => Promise<T>, success?: string) => Promise<T | null>;

export type SectionId =
  | 'ringkasan' | 'pengguna' | 'laporan' | 'moderasi'
  | 'langganan' | 'redeem' | 'konfigurasi' | 'audit';

export type ListResponse<T> = { items: T[] };

export type DashboardData = {
  activeUsers: number;
  suspendedUsers: number;
  pendingReports: number;
  communities: number;
  posts: number;
  subscriptions: number;
  mediaBytes: number;
  adminActions24h: number;
};

export type UserListItem = {
  id: string;
  email: string;
  username: string;
  displayName: string;
  status: string;
  role: string | null;
  planCode: string;
  createdAt: string;
};

export type ReportItem = {
  id: string;
  targetType: string;
  targetId: string;
  reason: string;
  detail: string | null;
  note: string | null;
  status: string;
  reporter: string;
  moderator: string | null;
  resolutionNote: string | null;
  createdAt: string;
  moderatedAt: string | null;
};

export type PostItem = {
  id: string;
  kind: string;
  audience: string;
  caption: string | null;
  status: string;
  author: string;
  community: string | null;
  createdAt: string;
};

export type CommunityItem = {
  id: string;
  slug: string;
  name: string;
  visibility: string;
  moderationStatus: string;
  moderationReason: string | null;
  owner: string;
  members: number;
  createdAt: string;
  moderatedAt: string | null;
};

export type SubscriptionItem = {
  id: string;
  planCode: string;
  provider: string;
  status: string;
  productId: string;
  autoRenew: boolean;
  username: string;
  email: string;
  startedAt: string;
  expiresAt: string | null;
  graceUntil: string | null;
  lastVerifiedAt: string | null;
};

export type RedeemItem = {
  id: string;
  codePrefix: string;
  rewardKind: string;
  rewardValue: Record<string, unknown>;
  quotaTotal: number;
  quotaUsed: number;
  remaining: number;
  expiresAt: string | null;
  active: boolean;
  createdAt: string;
};

export type AuditItem = {
  id: string;
  actor: string;
  action: string;
  targetType: string;
  targetId: string | null;
  reason: string;
  before: unknown;
  after: unknown;
  requestId: string | null;
  createdAt: string;
};

export type ConfigItem = {
  key: string;
  value: Record<string, unknown>;
  updatedBy: string | null;
  updatedAt: string;
};
