import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { AddressInfo } from 'node:net';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import WebSocket from 'ws';
import { PGliteDatabase } from './pglite.database.js';
import { runMigrations } from '../db/migrate.js';
import { buildTestApp, StubGeocodingProvider, SwitchableRoutingProvider } from './app.factory.js';
import { TokenService } from '../auth/token.service.js';

type Envelope = { v: number; id: string; type: string; room: string; seq: number; ts: string; data: Record<string, unknown> };
type Account = { id: string; token: string };

let db: PGliteDatabase;
let app: INestApplication;
let port = 0;
let tokens: TokenService;
const sockets: TestSocket[] = [];

class TestSocket {
  readonly events: Envelope[] = [];
  closedCode: number | null = null;
  private constructor(readonly ws: WebSocket) {
    ws.on('message', (raw) => {
      try {
        this.events.push(JSON.parse(raw.toString()) as Envelope);
      } catch {
        // A malformed frame is ignored here; the server tests own protocol validity.
      }
    });
    ws.on('close', (code) => {
      this.closedCode = code;
    });
  }

  static connect(ticket: string, sinceSeq = 0): Promise<TestSocket> {
    const url = `ws://127.0.0.1:${port}/v1/realtime?ticket=${encodeURIComponent(ticket)}&sinceSeq=${sinceSeq}`;
    const ws = new WebSocket(url);
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => reject(new Error('WebSocket open timeout')), 5000);
      ws.once('open', () => {
        clearTimeout(timer);
        const socket = new TestSocket(ws);
        sockets.push(socket);
        resolve(socket);
      });
      ws.once('error', (error) => {
        clearTimeout(timer);
        reject(error);
      });
    });
  }

  async waitFor(type: string, predicate: (event: Envelope) => boolean = () => true, timeoutMs = 6000): Promise<Envelope> {
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const index = this.events.findIndex((event) => event.type === type && predicate(event));
      if (index >= 0) return this.events.splice(index, 1)[0];
      await sleep(20);
    }
    throw new Error(`Timed out waiting for ${type}; received ${this.events.map((event) => event.type).join(', ')}`);
  }

  close(): void {
    this.ws.close();
  }
}

async function rejectedHandshake(ticket: string | null): Promise<number> {
  const query = ticket === null ? '' : `?ticket=${encodeURIComponent(ticket)}`;
  const ws = new WebSocket(`ws://127.0.0.1:${port}/v1/realtime${query}`);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('Expected handshake rejection')), 5000);
    ws.once('unexpected-response', (_request, response) => {
      clearTimeout(timer);
      const status = response.statusCode ?? 0;
      response.destroy();
      ws.terminate();
      resolve(status);
    });
    ws.once('open', () => {
      clearTimeout(timer);
      ws.close();
      reject(new Error('Handshake unexpectedly succeeded'));
    });
    ws.once('error', (error) => {
      clearTimeout(timer);
      reject(error);
    });
  });
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));
const api = () => request(app.getHttpServer());
const auth = (token: string) => ({ Authorization: `Bearer ${token}` });

async function register(label: string): Promise<Account> {
  const response = await api().post('/v1/auth/register').send({
    email: `${label}@example.com`,
    username: `rider_${label}`,
    displayName: `Rider ${label.toUpperCase()}`,
    password: 'correct-horse-battery',
  });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return { id: response.body.user.id, token: response.body.accessToken };
}

async function createRoute(account: Account): Promise<string> {
  const response = await api()
    .post('/v1/routes/preview')
    .set(auth(account.token))
    .send({ origin: { lat: -6.2, lng: 106.8 }, destination: { lat: -6.9, lng: 107.6 } });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.routes[0].id as string;
}

async function issueTicket(account: Account, convoyId: string): Promise<string> {
  const response = await api().post('/v1/realtime/ticket').set(auth(account.token)).send({ convoyId });
  assert.equal(response.status, 201, JSON.stringify(response.body));
  return response.body.ticket as string;
}

async function convoy(account: Account, convoyId: string) {
  const response = await api().get(`/v1/convoys/${convoyId}`).set(auth(account.token));
  return response;
}

async function approve(leader: Account, convoyId: string, target: Account): Promise<void> {
  const current = await convoy(leader, convoyId);
  const response = await api()
    .post(`/v1/convoys/${convoyId}/members/${target.id}/approve`)
    .set(auth(leader.token))
    .set('If-Match', String(current.body.version));
  assert.equal(response.status, 200, JSON.stringify(response.body));
}

async function start(leader: Account, convoyId: string): Promise<void> {
  const current = await convoy(leader, convoyId);
  const response = await api()
    .post(`/v1/convoys/${convoyId}/start`)
    .set(auth(leader.token))
    .set('If-Match', String(current.body.version));
  assert.equal(response.status, 200, JSON.stringify(response.body));
}

async function setSharing(account: Account, convoyId: string): Promise<void> {
  const response = await api()
    .patch(`/v1/convoys/${convoyId}/sharing`)
    .set(auth(account.token))
    .send({ sharingConsent: true });
  assert.equal(response.status, 200, JSON.stringify(response.body));
}

function location(recordedAt = new Date().toISOString(), extra: Record<string, unknown> = {}) {
  return {
    type: 'convoy.location.updated',
    data: {
      lat: -6.2,
      lng: 106.8,
      accuracyM: 8,
      headingDeg: 90,
      speedMps: 12,
      recordedAt,
      clientSeq: 1,
      ...extra,
    },
  };
}

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.AUTH_JWT_SECRET = 'phase-two-secret-with-at-least-32-characters';
  process.env.CONVOY_STALE_AFTER_SECONDS = '1';
  process.env.CONVOY_CAPACITY_DEFAULT = '3';
  process.env.CONVOY_CAPACITY_MAX = '30';
  db = await PGliteDatabase.create();
  const applied = await runMigrations(db);
  assert.deepEqual(applied, ['0001_init.sql', '0002_convoys.sql', '0003_phase3.sql', '0004_phase4.sql', '0005_community.sql', '0006_phase4_social.sql', '0007_phase5.sql', '0008_phase1.sql']);
  const built = await buildTestApp(db, new SwitchableRoutingProvider(), new StubGeocodingProvider());
  app = built.app;
  tokens = app.get(TokenService);
  await app.listen(0, '127.0.0.1');
  port = (app.getHttpServer().address() as AddressInfo).port;
});

after(async () => {
  for (const socket of sockets) socket.close();
  await app.close();
  await db.close();
});

test('convoy HTTP security, invite policy, lifecycle, and audit', async () => {
  const a = await register('cnv_a');
  const b = await register('cnv_b');
  const c = await register('cnv_c');
  const d = await register('cnv_d');
  const e = await register('cnv_e');

  await db.query(`INSERT INTO user_entitlements (user_id, plan_code, convoy_capacity) VALUES ($1, 'test', 5)`, [a.id]);
  const routeId = await createRoute(a);

  const overCapacity = await api()
    .post('/v1/convoys')
    .set(auth(a.token))
    .send({ name: 'Terlalu besar', meetingPoint: { lat: -6.2, lng: 106.8 }, destination: { lat: -6.9, lng: 107.6 }, capacity: 6 });
  assert.equal(overCapacity.status, 403, JSON.stringify(overCapacity.body));
  assert.equal(overCapacity.body.code, 'CONVOY_CAPACITY_NOT_ENTITLED');

  const spoofed = await api()
    .post('/v1/convoys')
    .set(auth(a.token))
    .send({
      name: 'Spoof',
      meetingPoint: { lat: -6.2, lng: 106.8 },
      destination: { lat: -6.9, lng: 107.6 },
      capacity: 5,
      role: 'leader',
      leaderId: b.id,
      planCode: 'pro',
    });
  assert.equal(spoofed.status, 422, JSON.stringify(spoofed.body));

  const created = await api()
    .post('/v1/convoys')
    .set(auth(a.token))
    .send({
      name: 'Konvoi Pagi',
      meetingPoint: { lat: -6.2, lng: 106.8 },
      destination: { lat: -6.9, lng: 107.6 },
      waypoints: [{ lat: -6.5, lng: 107.1, label: 'Rest area' }],
      scheduledAt: new Date(Date.now() + 3_600_000).toISOString(),
      capacity: 5,
      routeId,
    });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const convoyId = created.body.id as string;
  assert.equal(created.body.status, 'lobby');
  assert.equal(created.body.role, 'leader');
  assert.equal(created.body.capacity, 5);
  assert.match(created.body.inviteCode, /^[0-9A-HJKMNP-TV-Z]{10}$/);
  assert.match(created.body.inviteLink, /^riderjourney:\/\/convoy\/join\?code=/);

  const hashes = await db.query<{ code_hash: string; max_uses: number }>(
    'SELECT code_hash, max_uses FROM convoy_invites WHERE convoy_id = $1',
    [convoyId],
  );
  assert.equal(hashes.length, 1);
  assert.equal(hashes[0].code_hash.length, 64);
  assert.notEqual(hashes[0].code_hash, created.body.inviteCode);
  assert.equal(hashes[0].max_uses, 4);

  const nonMember = await convoy(b, convoyId);
  assert.equal(nonMember.status, 404);

  const joinB = await api().post('/v1/convoys/join').set(auth(b.token)).send({ code: created.body.inviteCode });
  assert.equal(joinB.status, 201, JSON.stringify(joinB.body));
  assert.equal(joinB.body.membershipStatus, 'requested');
  assert.equal(joinB.body.sharingConsent, false);

  const duplicateJoin = await api().post('/v1/convoys/join').set(auth(b.token)).send({ code: created.body.inviteCode });
  assert.equal(duplicateJoin.status, 409);
  assert.equal(duplicateJoin.body.code, 'ALREADY_IN_CONVOY');

  const joinC = await api().post('/v1/convoys/join').set(auth(c.token)).send({ code: created.body.inviteCode });
  assert.equal(joinC.status, 201);
  const joinD = await api().post('/v1/convoys/join').set(auth(d.token)).send({ code: created.body.inviteCode });
  assert.equal(joinD.status, 201);

  const requestedTicket = await api().post('/v1/realtime/ticket').set(auth(d.token)).send({ convoyId });
  assert.equal(requestedTicket.status, 403);

  const staleApprove = await api()
    .post(`/v1/convoys/${convoyId}/members/${b.id}/approve`)
    .set(auth(a.token))
    .set('If-Match', '999');
  assert.equal(staleApprove.status, 409);
  assert.equal(staleApprove.body.code, 'VERSION_MISMATCH');

  await approve(a, convoyId, b);
  await approve(a, convoyId, c);

  const leaderOnlyStart = await api().post(`/v1/convoys/${convoyId}/start`).set(auth(b.token));
  assert.equal(leaderOnlyStart.status, 403);
  assert.equal(leaderOnlyStart.body.code, 'CONVOY_LEADER_ONLY');
  const roleSpoof = await api()
    .patch(`/v1/convoys/${convoyId}/members/${c.id}`)
    .set(auth(b.token))
    .send({ role: 'co_leader' });
  assert.equal(roleSpoof.status, 403);
  assert.equal(roleSpoof.body.code, 'CONVOY_LEADER_ONLY');

  const sharedRoute = await api().get(`/v1/routes/${routeId}`).set(auth(b.token));
  assert.equal(sharedRoute.status, 200, JSON.stringify(sharedRoute.body));
  assert.ok(Array.isArray(sharedRoute.body.geometry.coordinates));
  assert.ok(sharedRoute.body.geometry.coordinates.length >= 2);
  const foreignRoute = await api().get(`/v1/routes/${routeId}`).set(auth(e.token));
  assert.equal(foreignRoute.status, 404);

  const rejectD = await api()
    .post(`/v1/convoys/${convoyId}/members/${d.id}/reject`)
    .set(auth(a.token))
    .send({ reason: 'Tidak dikenal' });
  assert.equal(rejectD.status, 200, JSON.stringify(rejectD.body));

  const revokedInvite = await api()
    .post(`/v1/convoys/${convoyId}/invites`)
    .set(auth(a.token))
    .send({ maxUses: 2 });
  assert.equal(revokedInvite.status, 201);
  const revoke = await api()
    .delete(`/v1/convoys/${convoyId}/invites/${revokedInvite.body.id}`)
    .set(auth(a.token));
  assert.equal(revoke.status, 200);
  const revokedJoin = await api().post('/v1/convoys/join').set(auth(e.token)).send({ code: revokedInvite.body.code });
  assert.equal(revokedJoin.status, 410);
  assert.equal(revokedJoin.body.code, 'INVITE_REVOKED');

  const expiredInvite = await api()
    .post(`/v1/convoys/${convoyId}/invites`)
    .set(auth(a.token))
    .send({ maxUses: 2 });
  assert.equal(expiredInvite.status, 201);
  await db.query(`UPDATE convoy_invites SET expires_at = now() - interval '1 minute' WHERE id = $1`, [expiredInvite.body.id]);
  const expiredJoin = await api().post('/v1/convoys/join').set(auth(e.token)).send({ code: expiredInvite.body.code });
  assert.equal(expiredJoin.status, 410);
  assert.equal(expiredJoin.body.code, 'INVITE_EXPIRED');

  const oneUseInvite = await api()
    .post(`/v1/convoys/${convoyId}/invites`)
    .set(auth(a.token))
    .send({ maxUses: 1 });
  assert.equal(oneUseInvite.status, 201);
  const dRejoin = await api().post('/v1/convoys/join').set(auth(d.token)).send({ code: oneUseInvite.body.code });
  assert.equal(dRejoin.status, 201, JSON.stringify(dRejoin.body));
  const exhausted = await api().post('/v1/convoys/join').set(auth(e.token)).send({ code: oneUseInvite.body.code });
  assert.equal(exhausted.status, 410);
  assert.equal(exhausted.body.code, 'INVITE_EXHAUSTED');

  const cancelRequest = await api().post(`/v1/convoys/${convoyId}/leave`).set(auth(d.token));
  assert.equal(cancelRequest.status, 200, JSON.stringify(cancelRequest.body));
  assert.equal(cancelRequest.body.status, 'left');

  await start(a, convoyId);
  const detail = await convoy(a, convoyId);
  assert.equal(detail.body.status, 'active');

  const progression = await api()
    .post(`/v1/convoys/${convoyId}/pause`)
    .set(auth(a.token))
    .set('If-Match', String(detail.body.version));
  assert.equal(progression.status, 200);
  assert.equal(progression.body.status, 'paused');
  const resumed = await api()
    .post(`/v1/convoys/${convoyId}/resume`)
    .set(auth(a.token))
    .set('If-Match', String(progression.body.version));
  assert.equal(resumed.status, 200);
  assert.equal(resumed.body.status, 'active');
  const completed = await api()
    .post(`/v1/convoys/${convoyId}/complete`)
    .set(auth(a.token))
    .set('If-Match', String(resumed.body.version));
  assert.equal(completed.status, 200, JSON.stringify(completed.body));
  assert.equal(completed.body.status, 'completed');
  const afterComplete = await convoy(a, convoyId);
  assert.equal(afterComplete.status, 200);
  assert.equal(afterComplete.body.status, 'completed');
  const audit = await db.query<{ action: string }>('SELECT action FROM convoy_audit_logs WHERE convoy_id = $1', [convoyId]);
  const actions = audit.map((row) => row.action);
  assert.ok(actions.includes('convoy.created'));
  assert.ok(actions.includes('member.approved'));
  assert.ok(actions.includes('invite.revoked'));
  assert.ok(actions.includes('status.completed'));
});

test('realtime authorization, isolation, stale, reconnect, and leader handoff', async () => {
  const a = await register('live_a');
  const b = await register('live_b');
  const c = await register('live_c');
  const d = await register('live_d');
  const f = await register('live_f');
  const g = await register('live_g');

  await db.query(`INSERT INTO user_entitlements (user_id, plan_code, convoy_capacity) VALUES ($1, 'test', 5)`, [a.id]);
  const routeId = await createRoute(a);
  const created = await api()
    .post('/v1/convoys')
    .set(auth(a.token))
    .send({
      name: 'Konvoi Live',
      meetingPoint: { lat: -6.2, lng: 106.8 },
      destination: { lat: -6.9, lng: 107.6 },
      capacity: 5,
      routeId,
    });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const convoyId = created.body.id as string;

  for (const member of [b, c]) {
    const joined = await api().post('/v1/convoys/join').set(auth(member.token)).send({ code: created.body.inviteCode });
    assert.equal(joined.status, 201);
    await approve(a, convoyId, member);
    await setSharing(member, convoyId);
  }
  await setSharing(a, convoyId);
  const requested = await api().post('/v1/convoys/join').set(auth(d.token)).send({ code: created.body.inviteCode });
  assert.equal(requested.status, 201);
  await start(a, convoyId);

  const noTicket = await rejectedHandshake(null);
  assert.equal(noTicket, 401);

  const aTicket = await issueTicket(a, convoyId);
  const bTicket = await issueTicket(b, convoyId);
  const cTicket = await issueTicket(c, convoyId);
  const aSocket = await TestSocket.connect(aTicket);
  const bSocket = await TestSocket.connect(bTicket);
  const cSocket = await TestSocket.connect(cTicket);
  const aSnapshot = await aSocket.waitFor('convoy.snapshot');
  await bSocket.waitFor('convoy.snapshot');
  await cSocket.waitFor('convoy.snapshot');
  assert.equal(aSnapshot.data.status, 'active');
  assert.equal(aSnapshot.data.role, 'leader');
  assert.ok((aSnapshot.data.members as unknown[]).length >= 3);

  const reused = await rejectedHandshake(cTicket);
  assert.equal(reused, 401);

  const firstRecorded = new Date(Date.now() - 1000).toISOString();
  bSocket.ws.send(JSON.stringify(location(firstRecorded, { userId: a.id, role: 'leader' })));
  const receivedByA = await aSocket.waitFor('convoy.location.updated', (event) => event.data.userId === b.id);
  const receivedByC = await cSocket.waitFor('convoy.location.updated', (event) => event.data.userId === b.id);
  assert.equal(receivedByA.data.role, undefined);
  assert.equal(receivedByC.data.userId, b.id);

  bSocket.ws.send(JSON.stringify(location(new Date().toISOString())));
  const rateLimited = await bSocket.waitFor('error', (event) => event.data.code === 'RATE_LIMITED');
  assert.equal(rateLimited.data.code, 'RATE_LIMITED');

  const stale = await aSocket.waitFor('convoy.location.stale', (event) => event.data.userId === b.id, 8000);
  assert.equal(stale.data.stale, true);

  await sleep(1100);
  bSocket.ws.send(JSON.stringify(location(firstRecorded)));
  const outOfOrder = await bSocket.waitFor('error', (event) => event.data.code === 'OUT_OF_ORDER');
  assert.equal(outOfOrder.data.code, 'OUT_OF_ORDER');

  const secondRoute = await createRoute(a);
  const beforeRoute = await convoy(a, convoyId);
  const routeUpdate = await api()
    .patch(`/v1/convoys/${convoyId}/route`)
    .set(auth(a.token))
    .set('If-Match', String(beforeRoute.body.version))
    .send({ routeId: secondRoute });
  assert.equal(routeUpdate.status, 200, JSON.stringify(routeUpdate.body));
  assert.equal(routeUpdate.body.routeVersion, 2);
  const routeEvent = await cSocket.waitFor('convoy.route.updated');
  assert.equal(routeEvent.data.routeId, secondRoute);

  const fConvoy = await api()
    .post('/v1/convoys')
    .set(auth(f.token))
    .send({ name: 'Konvoi Lain', meetingPoint: { lat: -7.1, lng: 107.1 }, destination: { lat: -7.2, lng: 107.2 }, capacity: 2 });
  assert.equal(fConvoy.status, 201);
  const gJoin = await api().post('/v1/convoys/join').set(auth(g.token)).send({ code: fConvoy.body.inviteCode });
  assert.equal(gJoin.status, 201);
  await approve(f, fConvoy.body.id, g);
  await setSharing(g, fConvoy.body.id);
  await start(f, fConvoy.body.id);
  const gSocket = await TestSocket.connect(await issueTicket(g, fConvoy.body.id));
  await gSocket.waitFor('convoy.snapshot');
  gSocket.ws.send(JSON.stringify(location(new Date().toISOString())));
  await gSocket.waitFor('convoy.location.updated', (event) => event.data.userId === g.id);

  const lastBeforeReconnect = Math.max(0, ...bSocket.events.map((event) => event.seq));
  bSocket.close();
  await sleep(250);
  await sleep(1100);
  aSocket.ws.send(JSON.stringify(location(new Date().toISOString())));
  await cSocket.waitFor('convoy.location.updated', (event) => event.data.userId === a.id);

  const reconnected = await TestSocket.connect(await issueTicket(b, convoyId), lastBeforeReconnect);
  await reconnected.waitFor('convoy.snapshot');
  const replay = await reconnected.waitFor('convoy.location.updated', (event) => event.data.userId === a.id, 3000).catch(() => null);
  assert.ok(replay, 'reconnect should replay events after sinceSeq');

  const roleAssign = await convoy(a, convoyId);
  const coLeader = await api()
    .patch(`/v1/convoys/${convoyId}/members/${c.id}`)
    .set(auth(a.token))
    .set('If-Match', String(roleAssign.body.version))
    .send({ role: 'co_leader' });
  assert.equal(coLeader.status, 200, JSON.stringify(coLeader.body));

  aSocket.close();
  let handoff: { role?: string } | null = null;
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(100);
    const current = await convoy(c, convoyId);
    if (current.body.role === 'leader') {
      handoff = current.body;
      break;
    }
  }
  assert.equal(handoff?.role, 'leader', 'co-leader should take over after leader disconnect');
  await cSocket.waitFor('convoy.member.updated', (event) => event.data.userId === c.id && event.data.role === 'leader', 5000);

  const leaveB = await api().post(`/v1/convoys/${convoyId}/leave`).set(auth(b.token));
  assert.equal(leaveB.status, 200, JSON.stringify(leaveB.body));
  await sleep(150);
  assert.equal(reconnected.closedCode, 4003);
  assert.ok(!cSocket.events.some((event) => event.type === 'convoy.location.updated' && event.data.userId === g.id));
  const leftEventCount = reconnected.events.length;
  cSocket.ws.send(JSON.stringify(location(new Date().toISOString())));
  await sleep(250);
  assert.equal(reconnected.events.length, leftEventCount, 'left member must not receive new room events');

  const beforeComplete = await convoy(c, convoyId);
  const complete = await api()
    .post(`/v1/convoys/${convoyId}/complete`)
    .set(auth(c.token))
    .set('If-Match', String(beforeComplete.body.version));
  assert.equal(complete.status, 200, JSON.stringify(complete.body));
  assert.equal(complete.body.status, 'completed');
  const positions = await api().get(`/v1/convoys/${convoyId}/positions`).set(auth(c.token));
  assert.equal(positions.status, 200);
  assert.deepEqual(positions.body.items, []);

  const audit = await db.query<{ action: string }>('SELECT action FROM convoy_audit_logs WHERE convoy_id = $1', [convoyId]);
  assert.ok(audit.some((row) => row.action === 'leadership.handoff'));

  const leaveLeader = await api().post(`/v1/convoys/${fConvoy.body.id}/leave`).set(auth(f.token));
  assert.equal(leaveLeader.status, 200, JSON.stringify(leaveLeader.body));
  assert.equal(leaveLeader.body.promotedUserId, g.id);
  const promotedConvoy = await convoy(g, fConvoy.body.id);
  assert.equal(promotedConvoy.body.leaderId, g.id);
  assert.equal(promotedConvoy.body.role, 'leader');
});

test('PRD capacity load: 30 WebSocket members and fanout', async () => {
  const leader = await register('load_leader');
  await db.query(`INSERT INTO user_entitlements (user_id, plan_code, convoy_capacity) VALUES ($1, 'load', 30)`, [leader.id]);
  const created = await api()
    .post('/v1/convoys')
    .set(auth(leader.token))
    .send({ name: 'Konvoi Beban', meetingPoint: { lat: -6.2, lng: 106.8 }, destination: { lat: -6.9, lng: 107.6 }, capacity: 30 });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const convoyId = created.body.id as string;
  await setSharing(leader, convoyId);

  const accounts: Account[] = [leader];
  for (let index = 0; index < 29; index += 1) {
    const userId = randomUUID();
    await db.query(
      `INSERT INTO users (id, email, username, display_name, status, email_verified)
       VALUES ($1, $2, $3, $4, 'active', true)`,
      [userId, `load${index}@example.com`, `load_${index}`, `Load ${index}`],
    );
    await db.query(
      `INSERT INTO convoy_members (convoy_id, user_id, role, status, sharing_consent, joined_at)
       VALUES ($1, $2, 'member', 'active', true, now())`,
      [convoyId, userId],
    );
    const issued = await tokens.issue(userId);
    accounts.push({ id: userId, token: issued.accessToken });
  }

  await start(leader, convoyId);
  const startedAt = Date.now();
  const clients = await Promise.all(
    accounts.map(async (account) => {
      const socket = await TestSocket.connect(await issueTicket(account, convoyId));
      await socket.waitFor('convoy.snapshot');
      return socket;
    }),
  );
  const connectedMs = Date.now() - startedAt;

  const collector = clients[0];
  const loadStart = Date.now();
  for (const [index, client] of clients.entries()) {
    client.ws.send(
      JSON.stringify(
        location(new Date().toISOString(), {
          lat: -6.2 - index * 0.0001,
          lng: 106.8 - index * 0.0001,
          clientSeq: index + 1,
        }),
      ),
    );
  }
  const received: Envelope[] = [];
  while (received.length < 30 && Date.now() - loadStart < 15_000) {
    const event = await collector.waitFor('convoy.location.updated', () => true, 15_000).catch(() => null);
    if (!event) break;
    received.push(event);
  }
  const fanoutMs = Date.now() - loadStart;
  assert.equal(received.length, 30, `expected 30 fanout events, got ${received.length}`);
  const uniqueSenders = new Set(received.map((event) => event.data.userId));
  assert.equal(uniqueSenders.size, 30);
  assert.ok(fanoutMs < 15_000, `fanout took ${fanoutMs}ms`);
  const members = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM convoy_members WHERE convoy_id = $1 AND status = $2', [convoyId, 'active']);
  assert.equal(members[0].count, 30);
  console.log(`PHASE2_LOAD capacity=30 connectedMs=${connectedMs} fanoutMs=${fanoutMs} store=memory profile=node-test`);
  for (const client of clients) client.close();
});

test('chat blocks are two-way and reject sends until unblocked', async () => {
  const a = await register('chat_a');
  const b = await register('chat_b');
  await db.query(`INSERT INTO user_entitlements (user_id, plan_code, convoy_capacity) VALUES ($1, 'test', 3)`, [a.id]);
  const created = await api()
    .post('/v1/convoys')
    .set(auth(a.token))
    .send({ name: 'Konvoi Chat', meetingPoint: { lat: -6.2, lng: 106.8 }, destination: { lat: -6.9, lng: 107.6 }, capacity: 3 });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const convoyId = created.body.id as string;
  const joined = await api().post('/v1/convoys/join').set(auth(b.token)).send({ code: created.body.inviteCode });
  assert.equal(joined.status, 201, JSON.stringify(joined.body));
  await approve(a, convoyId, b);

  const sendAs = (account: Account, clientMessageId: string, body: string) =>
    api()
      .post(`/v1/convoys/${convoyId}/messages`)
      .set(auth(account.token))
      .send({ clientMessageId, kind: 'text', body });
  const listAs = (account: Account) => api().get(`/v1/convoys/${convoyId}/messages`).set(auth(account.token));

  const fromA = await sendAs(a, 'chat-a-0001', 'Halo dari A');
  assert.equal(fromA.status, 201, JSON.stringify(fromA.body));
  const fromB = await sendAs(b, 'chat-b-0001', 'Halo dari B');
  assert.equal(fromB.status, 201, JSON.stringify(fromB.body));

  const beforeBlockB = await listAs(b);
  assert.ok(beforeBlockB.body.items.some((item: { id: string }) => item.id === fromA.body.id));
  const beforeBlockA = await listAs(a);
  assert.ok(beforeBlockA.body.items.some((item: { id: string }) => item.id === fromB.body.id));

  const block = await api().post(`/v1/users/${a.id}/block`).set(auth(b.token));
  assert.equal(block.status, 200, JSON.stringify(block.body));

  // B blocked A: A must stop seeing B's messages, and B stops seeing A's.
  const afterBlockA = await listAs(a);
  assert.ok(!afterBlockA.body.items.some((item: { id: string }) => item.id === fromB.body.id));
  const afterBlockB = await listAs(b);
  assert.ok(!afterBlockB.body.items.some((item: { id: string }) => item.id === fromA.body.id));

  const blockedA = await sendAs(a, 'chat-a-0002', 'Masih bisa?');
  assert.equal(blockedA.status, 403, JSON.stringify(blockedA.body));
  assert.equal(blockedA.body.code, 'CHAT_BLOCKED');
  const blockedB = await sendAs(b, 'chat-b-0002', 'Dari sisi blocker');
  assert.equal(blockedB.status, 403, JSON.stringify(blockedB.body));
  assert.equal(blockedB.body.code, 'CHAT_BLOCKED');

  const unblock = await api().delete(`/v1/users/${a.id}/block`).set(auth(b.token));
  assert.equal(unblock.status, 200, JSON.stringify(unblock.body));

  const fromAAgain = await sendAs(a, 'chat-a-0003', 'Terhubung lagi');
  assert.equal(fromAAgain.status, 201, JSON.stringify(fromAAgain.body));
  const restoredB = await listAs(b);
  assert.ok(restoredB.body.items.some((item: { id: string }) => item.id === fromAAgain.body.id));
  assert.ok(restoredB.body.items.some((item: { id: string }) => item.id === fromA.body.id));
  const restoredA = await listAs(a);
  assert.ok(restoredA.body.items.some((item: { id: string }) => item.id === fromB.body.id));
});
