import { cookies } from 'next/headers';
import { ACCESS_COOKIE, API_URL, REFRESH_COOKIE } from './config';

export type AdminSession = {
  userId: string;
  role: 'support' | 'moderator' | 'admin' | 'superadmin';
  permissions: string[];
  mfa: { enrolled: boolean; stepUpTtlSeconds: number };
};

async function fetchAdmin(accessToken: string): Promise<AdminSession | null> {
  const response = await fetch(`${API_URL}/v1/admin/me`, {
    headers: { Authorization: `Bearer ${accessToken}` },
    cache: 'no-store',
  });
  if (!response.ok) return null;
  return (await response.json()) as AdminSession;
}

/** Server-side guard for the console page. Refresh is used for this request only. */
export async function currentAdmin(): Promise<AdminSession | null> {
  const store = await cookies();
  const access = store.get(ACCESS_COOKIE)?.value;
  if (access) {
    const admin = await fetchAdmin(access);
    if (admin) return admin;
  }
  const refresh = store.get(REFRESH_COOKIE)?.value;
  if (!refresh) return null;
  const refreshed = await fetch(`${API_URL}/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: refresh }),
    cache: 'no-store',
  });
  if (!refreshed.ok) return null;
  const tokens = (await refreshed.json()) as { accessToken?: string };
  if (!tokens.accessToken) return null;
  return fetchAdmin(tokens.accessToken);
}
