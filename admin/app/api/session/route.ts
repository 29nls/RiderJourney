import { NextResponse } from 'next/server';
import { ACCESS_COOKIE, API_URL, cookieOptions, REFRESH_COOKIE } from '@/lib/config';

export async function POST(request: Request) {
  const body = (await request.json().catch(() => ({}))) as { email?: string; password?: string };
  if (!body.email || !body.password) {
    return NextResponse.json({ code: 'INVALID_CREDENTIALS', title: 'Email dan kata sandi diperlukan' }, { status: 400 });
  }
  const login = await fetch(`${API_URL}/v1/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: body.email, password: body.password }),
    cache: 'no-store',
  });
  const tokens = (await login.json().catch(() => ({}))) as {
    accessToken?: string; refreshToken?: string; code?: string; title?: string; detail?: string;
  };
  if (!login.ok || !tokens.accessToken || !tokens.refreshToken) {
    return NextResponse.json(
      { code: tokens.code ?? 'LOGIN_FAILED', title: tokens.title ?? 'Login gagal', detail: tokens.detail ?? 'Periksa email dan kata sandi.' },
      { status: login.status === 200 ? 401 : login.status },
    );
  }
  const me = await fetch(`${API_URL}/v1/admin/me`, {
    headers: { Authorization: `Bearer ${tokens.accessToken}` },
    cache: 'no-store',
  });
  if (!me.ok) {
    return NextResponse.json(
      { code: 'ADMIN_FORBIDDEN', title: 'Akses admin ditolak', detail: 'Akun ini tidak memiliki akses konsol admin.' },
      { status: 403 },
    );
  }
  const admin = await me.json();
  const response = NextResponse.json({ admin });
  response.cookies.set(ACCESS_COOKIE, tokens.accessToken, { ...cookieOptions, maxAge: 60 * 60 });
  response.cookies.set(REFRESH_COOKIE, tokens.refreshToken, { ...cookieOptions, maxAge: 60 * 60 * 24 * 30 });
  return response;
}

export async function DELETE() {
  const response = NextResponse.json({ ok: true });
  response.cookies.set(ACCESS_COOKIE, '', { ...cookieOptions, maxAge: 0 });
  response.cookies.set(REFRESH_COOKIE, '', { ...cookieOptions, maxAge: 0 });
  return response;
}
