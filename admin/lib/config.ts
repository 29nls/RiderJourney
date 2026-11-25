export const API_URL = process.env.RIDERJOURNEY_API_URL ?? 'http://127.0.0.1:3000';
export const ACCESS_COOKIE = 'rj_admin_access';
export const REFRESH_COOKIE = 'rj_admin_refresh';

export const cookieOptions = {
  httpOnly: true,
  sameSite: 'lax' as const,
  secure: process.env.NODE_ENV === 'production',
  path: '/',
};
