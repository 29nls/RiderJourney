import { NextResponse } from 'next/server';
import { cookies } from 'next/headers';
import { ACCESS_COOKIE, API_URL, REFRESH_COOKIE, cookieOptions } from '@/lib/config';

type Context = { params: Promise<{ path: string[] }> };

async function refreshTokens(): Promise<{ accessToken: string; refreshToken: string } | null> {
  const store = await cookies();
  const refresh = store.get(REFRESH_COOKIE)?.value;
  if (!refresh) return null;
  const response = await fetch(`${API_URL}/v1/auth/refresh`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ refreshToken: refresh }),
    cache: 'no-store',
  });
  if (!response.ok) return null;
  const body = (await response.json()) as { accessToken?: string; refreshToken?: string };
  if (!body.accessToken || !body.refreshToken) return null;
  return { accessToken: body.accessToken, refreshToken: body.refreshToken };
}

async function proxy(request: Request, context: Context): Promise<NextResponse> {
  const { path } = await context.params;
  const store = await cookies();
  let access = store.get(ACCESS_COOKIE)?.value;
  const target = new URL(request.url);
  const url = `${API_URL}/v1/admin/${path.join('/')}${target.search}`;
  const body = ['GET', 'HEAD'].includes(request.method) ? undefined : await request.text();
  const headers = new Headers();
  if (access) headers.set('Authorization', `Bearer ${access}`);
  const contentType = request.headers.get('content-type');
  if (contentType) headers.set('Content-Type', contentType);
  const stepUp = request.headers.get('x-step-up-token');
  if (stepUp) headers.set('X-Step-Up-Token', stepUp);
  const requestId = request.headers.get('x-request-id');
  if (requestId) headers.set('X-Request-Id', requestId);

  let response = await fetch(url, { method: request.method, headers, body, cache: 'no-store' });
  let refreshed: { accessToken: string; refreshToken: string } | null = null;
  if (response.status === 401) {
    refreshed = await refreshTokens();
    if (refreshed) {
      access = refreshed.accessToken;
      headers.set('Authorization', `Bearer ${access}`);
      response = await fetch(url, { method: request.method, headers, body, cache: 'no-store' });
    }
  }
  const text = await response.text();
  const result = new NextResponse(text, {
    status: response.status,
    headers: {
      'Content-Type': response.headers.get('content-type') ?? 'application/json',
      'Cache-Control': 'no-store',
    },
  });
  if (refreshed) {
    result.cookies.set(ACCESS_COOKIE, refreshed.accessToken, { ...cookieOptions, maxAge: 60 * 60 });
    result.cookies.set(REFRESH_COOKIE, refreshed.refreshToken, { ...cookieOptions, maxAge: 60 * 60 * 24 * 30 });
  }
  return result;
}

export const GET = proxy;
export const POST = proxy;
export const PUT = proxy;
export const PATCH = proxy;
export const DELETE = proxy;
