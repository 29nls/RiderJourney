#!/usr/bin/env node
/**
 * RiderJourney load harness. It writes real data, so it refuses to run unless
 * LOAD_TEST_CONFIRM=RUN. Use a staging database only, never production.
 *
 * Scenarios: auth/vehicle setup, PostGIS nearby query, media upload intent,
 * convoy create/join/approve/start, WebSocket snapshot, live location fanout.
 */
import { randomUUID } from 'node:crypto';
import WebSocket from 'ws';

const BASE = (process.env.LOAD_TEST_BASE_URL ?? 'http://127.0.0.1:3000').replace(/\/$/, '');
const WS_BASE = BASE.replace(/^http/, 'ws');
const USERS = Math.max(2, Number(process.env.LOAD_TEST_USERS ?? 5));
const DURATION_S = Math.max(5, Number(process.env.LOAD_TEST_DURATION_SECONDS ?? 20));
const MAX_ERROR_RATE = Number(process.env.LOAD_TEST_MAX_ERROR_RATE ?? 0.1);
const PASSWORD = process.env.LOAD_TEST_PASSWORD ?? 'load-test-correct-horse';

if (process.env.LOAD_TEST_CONFIRM !== 'RUN') {
  console.error('Refusing to write load-test data. Set LOAD_TEST_CONFIRM=RUN for a staging target.');
  process.exit(2);
}
if (/prod/i.test(BASE)) {
  console.error('Refusing a URL that looks like production.');
  process.exit(2);
}

const latencies = [];
const errors = [];
const counters = { api: 0, wsSent: 0, wsReceived: 0, wsOpened: 0, setup: 0, media: 0 };
const started = Date.now();

function percentile(values, p) {
  if (values.length === 0) return null;
  const sorted = [...values].sort((a, b) => a - b);
  return Number(sorted[Math.min(sorted.length - 1, Math.floor(p * sorted.length))].toFixed(1));
}

async function request(path, { method = 'GET', token, body } = {}) {
  const begin = performance.now();
  const response = await fetch(`${BASE}${path}`, {
    method,
    headers: {
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
      ...(body ? { 'Content-Type': 'application/json' } : {}),
    },
    body: body ? JSON.stringify(body) : undefined,
  });
  const elapsed = performance.now() - begin;
  latencies.push(elapsed);
  counters.api += 1;
  const text = await response.text();
  let payload = {};
  try { payload = text ? JSON.parse(text) : {}; } catch { payload = { raw: text.slice(0, 200) }; }
  if (!response.ok) {
    errors.push({ path, status: response.status, code: payload.code ?? 'HTTP_ERROR' });
    throw new Error(`${method} ${path} -> ${response.status} ${payload.code ?? ''}`);
  }
  return payload;
}

async function setup() {
  const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
  const users = [];
  for (let index = 0; index < USERS; index += 1) {
    const registered = await request('/v1/auth/register', {
      method: 'POST',
      body: {
        email: `load-${suffix}-${index}@example.test`,
        username: `load_${suffix}_${index}`.slice(0, 30),
        displayName: `Load ${index}`,
        password: PASSWORD,
      },
    });
    users.push({ id: registered.user.id, token: registered.accessToken });
  }
  const leader = users[0];
  const convoy = await request('/v1/convoys', {
    method: 'POST',
    token: leader.token,
    body: {
      name: `Load convoy ${suffix}`,
      meetingPoint: { lat: -6.1754, lng: 106.8272 },
      destination: { lat: -6.2, lng: 106.85 },
      capacity: users.length,
    },
  });
  for (const member of users.slice(1)) {
    await request('/v1/convoys/join', { method: 'POST', token: member.token, body: { code: convoy.inviteCode } });
    await request(`/v1/convoys/${convoy.id}/members/${member.id}/approve`, { method: 'POST', token: leader.token });
  }
  for (const user of users) {
    await request(`/v1/convoys/${convoy.id}/sharing`, {
      method: 'PATCH', token: user.token, body: { sharingConsent: true },
    });
  }
  await request(`/v1/convoys/${convoy.id}/start`, { method: 'POST', token: leader.token });
  counters.setup = users.length;
  return { users, convoyId: convoy.id };
}

function openSocket(user, convoyId) {
  return new Promise((resolve, reject) => {
    request('/v1/realtime/ticket', { method: 'POST', token: user.token, body: { convoyId } })
      .then((ticket) => {
        const socket = new WebSocket(`${WS_BASE}/v1/realtime?ticket=${encodeURIComponent(ticket.ticket)}`, {
          origin: process.env.LOAD_TEST_ORIGIN ?? undefined,
        });
        const timer = setTimeout(() => reject(new Error('WebSocket open timeout')), 10_000);
        socket.once('open', () => { clearTimeout(timer); counters.wsOpened += 1; resolve(socket); });
        socket.once('error', (error) => { clearTimeout(timer); reject(error); });
        socket.on('message', (raw) => {
          counters.wsReceived += 1;
          try {
            const event = JSON.parse(String(raw));
            if (event.type === 'error') errors.push({ path: 'ws', code: event.data?.code ?? 'WS_ERROR' });
          } catch { errors.push({ path: 'ws', code: 'WS_INVALID_JSON' }); }
        });
      })
      .catch(reject);
  });
}

async function postGisAndMedia(users) {
  for (const user of users) {
    await request('/v1/hazards/nearby?lat=-6.1754&lng=106.8272&radiusM=5000', { token: user.token });
    try {
      await request('/v1/media/uploads', {
        method: 'POST',
        token: user.token,
        body: {
          purpose: 'hazard_photo', contentType: 'image/jpeg', sizeBytes: 4096,
          clientMediaId: `load-${randomUUID()}`,
        },
      });
      counters.media += 1;
    } catch (error) {
      errors.push({ path: 'media', code: error.message.includes('503') ? 'STORAGE_NOT_CONFIGURED' : 'MEDIA_FAILED' });
    }
  }
}

async function run() {
  console.log(JSON.stringify({ event: 'start', base: BASE, users: USERS, durationSeconds: DURATION_S }));
  const { users, convoyId } = await setup();
  await postGisAndMedia(users);
  const sockets = await Promise.all(users.map((user) => openSocket(user, convoyId)));
  const endsAt = Date.now() + DURATION_S * 1000;
  let seq = 0;
  const senders = sockets.map((socket, index) => new Promise((resolve) => {
    const timer = setInterval(() => {
      if (Date.now() >= endsAt || socket.readyState !== WebSocket.OPEN) {
        clearInterval(timer);
        resolve();
        return;
      }
      seq += 1;
      const message = {
        v: 1,
        id: randomUUID(),
        type: 'convoy.location.updated',
        data: {
          convoyId,
          lat: -6.1754 + index * 0.0001 + Math.random() * 0.0001,
          lng: 106.8272 + index * 0.0001 + Math.random() * 0.0001,
          accuracyM: 8,
          headingDeg: 90,
          speedMps: 8,
          recordedAt: new Date().toISOString(),
          clientSeq: seq,
        },
      };
      socket.send(JSON.stringify(message));
      counters.wsSent += 1;
    }, 2100);
  }));
  await Promise.all(senders);
  for (const socket of sockets) socket.close(1000, 'load test done');
  const totalRequests = counters.api + counters.wsSent + counters.wsReceived;
  const errorRate = totalRequests === 0 ? 1 : errors.length / totalRequests;
  const report = {
    event: 'finish',
    durationSeconds: Number(((Date.now() - started) / 1000).toFixed(1)),
    counters,
    latencyMs: { p50: percentile(latencies, 0.5), p95: percentile(latencies, 0.95), max: percentile(latencies, 1) },
    errorRate: Number(errorRate.toFixed(4)),
    errors: errors.slice(0, 20),
    note: 'Error rate is capped at LOAD_TEST_MAX_ERROR_RATE. Media intent is skipped when object storage is not configured.',
  };
  console.log(JSON.stringify(report, null, 2));
  if (errorRate > MAX_ERROR_RATE) process.exitCode = 1;
}

run().catch((error) => {
  console.error(JSON.stringify({ event: 'failed', message: error.message, errors: errors.slice(0, 10) }, null, 2));
  process.exitCode = 1;
});
