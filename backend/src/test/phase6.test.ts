import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import type { INestApplication } from '@nestjs/common';
import request from 'supertest';
import { PGliteDatabase } from './pglite.database.js';
import { runMigrations } from '../db/migrate.js';
import { buildTestApp } from './app.factory.js';

/**
 * Phase 6 regression tests for the P0 authentication and authorization fixes.
 * Each test states the failure mode it would catch if the fix were reverted.
 */

let db: PGliteDatabase;
let app: INestApplication;
let server: unknown;

const api = () => request(server as Parameters<typeof request>[0]);
const PASSWORD = 'correct-horse-battery';
const NEW_PASSWORD = 'replacement-horse-battery';

async function register(email: string, username: string) {
  const res = await api().post('/v1/auth/register').send({
    email,
    username,
    displayName: 'Phase Six',
    password: PASSWORD,
  });
  assert.equal(res.status, 201, JSON.stringify(res.body));
  return res.body as { accessToken: string; refreshToken: string; verificationToken?: string };
}

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.PLATE_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString('base64');
  db = await PGliteDatabase.create();
  await runMigrations(db);
  const built = await buildTestApp(db);
  app = built.app;
  server = app.getHttpServer();
});

after(async () => {
  await app.close();
  await db.close();
});

test('login lockout counts failures per account, not per address', async () => {
  await register('lock@example.com', 'phase6_lock');

  for (let attempt = 1; attempt <= 9; attempt += 1) {
    const res = await api().post('/v1/auth/login').send({ email: 'lock@example.com', password: 'wrong-password-here' });
    assert.equal(res.status, 401, `attempt ${attempt}: ${JSON.stringify(res.body)}`);
    assert.equal(res.body.code, 'INVALID_CREDENTIALS');
  }

  const tenth = await api().post('/v1/auth/login').send({ email: 'lock@example.com', password: 'wrong-password-here' });
  assert.equal(tenth.status, 429, JSON.stringify(tenth.body));
  assert.equal(tenth.body.code, 'LOGIN_LOCKED');
  assert.ok(tenth.body.retryAfterSeconds > 0);

  // The correct password must not bypass an active lock: otherwise the lock only
  // slows guesses that are wrong, which is not the attack it is meant to stop.
  const correctWhileLocked = await api().post('/v1/auth/login').send({ email: 'lock@example.com', password: PASSWORD });
  assert.equal(correctWhileLocked.status, 429, JSON.stringify(correctWhileLocked.body));
  assert.equal(correctWhileLocked.body.code, 'LOGIN_LOCKED');

  await db.query(`UPDATE login_throttles SET locked_until = now() - interval '1 second'`);

  const afterWindow = await api().post('/v1/auth/login').send({ email: 'lock@example.com', password: PASSWORD });
  assert.equal(afterWindow.status, 200, JSON.stringify(afterWindow.body));

  const cleared = await db.query<{ count: number }>('SELECT count(*)::int AS count FROM login_throttles');
  assert.equal(cleared[0].count, 0, 'a successful login must clear the counter so one old typo does not accumulate');
});

test('password reset token is single-use even when two confirmations race', async () => {
  const account = await register('reset@example.com', 'phase6_reset');

  const requested = await api().post('/v1/auth/password/reset/request').send({ email: 'reset@example.com' });
  assert.equal(requested.status, 202, JSON.stringify(requested.body));
  const token = requested.body.devToken as string;
  assert.ok(token, 'test config exposes dev tokens');

  const [first, second] = await Promise.all([
    api().post('/v1/auth/password/reset/confirm').send({ token, newPassword: NEW_PASSWORD }),
    api().post('/v1/auth/password/reset/confirm').send({ token, newPassword: NEW_PASSWORD }),
  ]);

  const statuses = [first.status, second.status].sort();
  assert.deepEqual(statuses, [204, 401], `exactly one confirmation may win: ${JSON.stringify([first.body, second.body])}`);
  const rejected = first.status === 401 ? first : second;
  assert.equal(rejected.body.code, 'INVALID_RESET_TOKEN');

  const reused = await api().post('/v1/auth/password/reset/confirm').send({ token, newPassword: PASSWORD });
  assert.equal(reused.status, 401);
  assert.equal(reused.body.code, 'INVALID_RESET_TOKEN');

  const newLogin = await api().post('/v1/auth/login').send({ email: 'reset@example.com', password: NEW_PASSWORD });
  assert.equal(newLogin.status, 200, JSON.stringify(newLogin.body));

  const oldRefresh = await api().post('/v1/auth/refresh').send({ refreshToken: account.refreshToken });
  assert.equal(oldRefresh.status, 401, 'resetting a password must revoke sessions issued before it');
});

test('malformed or unknown route ids answer 400/404 instead of a database error', async () => {
  const account = await register('ids@example.com', 'phase6_ids');
  const auth = { Authorization: `Bearer ${account.accessToken}` };

  const badConvoy = await api().get('/v1/convoys/not-a-uuid/messages').set(auth);
  assert.equal(badConvoy.status, 400, JSON.stringify(badConvoy.body));
  assert.equal(badConvoy.body.code, 'INVALID_ID');

  const badHazard = await api().post('/v1/hazards/not-a-uuid/confirm').set(auth).send({ verdict: 'still_present' });
  assert.equal(badHazard.status, 400, JSON.stringify(badHazard.body));
  assert.equal(badHazard.body.code, 'INVALID_ID');

  const unknownConvoy = await api().get(`/v1/convoys/${randomUUID()}/messages`).set(auth);
  assert.equal(unknownConvoy.status, 404, JSON.stringify(unknownConvoy.body));

  const unknownHazard = await api().post(`/v1/hazards/${randomUUID()}/confirm`).set(auth).send({ verdict: 'still_present' });
  assert.equal(unknownHazard.status, 404, JSON.stringify(unknownHazard.body));
  assert.equal(unknownHazard.body.code, 'HAZARD_NOT_FOUND');
});
