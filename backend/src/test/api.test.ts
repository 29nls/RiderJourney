import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PGliteDatabase } from './pglite.database.js';
import { runMigrations } from '../db/migrate.js';
import { buildTestApp, SwitchableRoutingProvider } from './app.factory.js';

let db: PGliteDatabase;
let app: INestApplication;
let routing: SwitchableRoutingProvider;
let server: unknown;
let tokenA = '';
let tokenB = '';
let vehicleA = '';
let verificationA = '';

const api = () => request(server as Parameters<typeof request>[0]);

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.PLATE_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
  db = await PGliteDatabase.create();
  const applied = await runMigrations(db);
  assert.deepEqual(applied, ['0001_init.sql', '0002_convoys.sql', '0003_phase3.sql', '0004_phase4.sql', '0005_community.sql', '0006_phase4_social.sql', '0007_phase5.sql', '0008_phase1.sql', '0009_phase6.sql', '0010_phase6_1.sql', '0011_phase6_2.sql', '0012_phase6_3.sql', '0013_phase6_4.sql']);
  const built = await buildTestApp(db);
  app = built.app;
  routing = built.routing;
  server = app.getHttpServer();

  const a = await api().post('/v1/auth/register').send({
    email: 'a@example.com',
    username: 'rider_a',
    displayName: 'Rider A',
    password: 'correct-horse-battery',
  });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  tokenA = a.body.accessToken;
  verificationA = a.body.verificationToken;

  const b = await api().post('/v1/auth/register').send({
    email: 'b@example.com',
    username: 'rider_b',
    displayName: 'Rider B',
    password: 'correct-horse-battery',
  });
  assert.equal(b.status, 201, JSON.stringify(b.body));
  tokenB = b.body.accessToken;
});

after(async () => {
  await app.close();
  await db.close();
});

test('health and migration report PostgreSQL with PostGIS', async () => {
  const live = await api().get('/health/live');
  assert.equal(live.status, 200);
  const ready = await api().get('/health/ready');
  assert.equal(ready.status, 200);
  assert.match(String(ready.body.postgis), /^3\./);
  const tables = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  const names = tables.map((t) => t.table_name);
  for (const table of ['users', 'vehicles', 'routes', 'trips', 'trip_points']) assert.ok(names.includes(table));
});

test('registration, duplicate rejection, session validation, and cross-user isolation', async () => {
  const duplicate = await api().post('/v1/auth/register').send({
    email: 'a@example.com',
    username: 'another_name',
    displayName: 'Duplicate',
    password: 'correct-horse-battery',
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'EMAIL_TAKEN');

  const session = await api().get('/v1/auth/session').set('Authorization', `Bearer ${tokenA}`);
  assert.equal(session.status, 200);
  assert.equal(session.body.email, 'a@example.com');

  const anonymous = await api().get('/v1/auth/session');
  assert.equal(anonymous.status, 401);
  assert.equal(anonymous.body.code, 'UNAUTHENTICATED');

  assert.ok(verificationA);
  const verified = await api().post('/v1/auth/email/verify').send({ token: verificationA });
  assert.equal(verified.status, 200);
  const afterVerify = await api().get('/v1/auth/session').set('Authorization', `Bearer ${tokenA}`);
  assert.equal(afterVerify.body.emailVerified, true);
});

test('login, refresh rotation, logout, and password reset', async () => {
  const login = await api().post('/v1/auth/login').send({ email: 'a@example.com', password: 'correct-horse-battery' });
  assert.equal(login.status, 200);
  const oldRefresh = login.body.refreshToken;

  const rotated = await api().post('/v1/auth/refresh').send({ refreshToken: oldRefresh });
  assert.equal(rotated.status, 200);
  assert.ok(rotated.body.accessToken);
  const replay = await api().post('/v1/auth/refresh').send({ refreshToken: oldRefresh });
  assert.equal(replay.status, 401);

  const wrong = await api().post('/v1/auth/login').send({ email: 'a@example.com', password: 'wrong-password' });
  assert.equal(wrong.status, 401);

  const resetRequest = await api().post('/v1/auth/password/reset/request').send({ email: 'b@example.com' });
  assert.equal(resetRequest.status, 202);
  assert.ok(resetRequest.body.devToken);
  const reset = await api()
    .post('/v1/auth/password/reset/confirm')
    .send({ token: resetRequest.body.devToken, newPassword: 'new-correct-horse' });
  assert.equal(reset.status, 204);
  const oldLogin = await api().post('/v1/auth/login').send({ email: 'b@example.com', password: 'correct-horse-battery' });
  assert.equal(oldLogin.status, 401);
  const newLogin = await api().post('/v1/auth/login').send({ email: 'b@example.com', password: 'new-correct-horse' });
  assert.equal(newLogin.status, 200);

  const logout = await api()
    .post('/v1/auth/logout')
    .set('Authorization', `Bearer ${rotated.body.accessToken}`)
    .send({ refreshToken: rotated.body.refreshToken });
  assert.equal(logout.status, 204);
  const afterLogout = await api().post('/v1/auth/refresh').send({ refreshToken: rotated.body.refreshToken });
  assert.equal(afterLogout.status, 401);
});

test('profile and privacy settings update', async () => {
  const updated = await api()
    .patch('/v1/me')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ displayName: 'Rider A Updated', city: 'Bandung', visibility: 'followers' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.displayName, 'Rider A Updated');
  assert.equal(updated.body.visibility, 'followers');

  const settings = await api()
    .patch('/v1/me/settings')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ tripHistoryVisibility: 'private', locationSharingDefault: false });
  assert.equal(settings.status, 200);
  assert.equal(settings.body.tripHistoryVisibility, 'private');
  assert.equal(settings.body.locationSharingDefault, false);

  const consent = await api()
    .post('/v1/me/consents')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ kind: 'privacy', version: '2026-11', context: 'test' });
  assert.equal(consent.status, 201);

  const badAvatar = await api()
    .patch('/v1/me')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ avatarUrl: 'javascript:alert(1)' });
  assert.equal(badAvatar.status, 422);

  const avatar = await api()
    .patch('/v1/me')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ avatarUrl: 'https://cdn.example.com/a.jpg' });
  assert.equal(avatar.status, 200, JSON.stringify(avatar.body));
  assert.equal(avatar.body.avatarUrl, 'https://cdn.example.com/a.jpg');

  const cleared = await api()
    .patch('/v1/me')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ avatarUrl: '' });
  assert.equal(cleared.status, 200);
  assert.equal(cleared.body.avatarUrl, null);
});

test('vehicle CRUD, primary vehicle, and plate privacy', async () => {
  const created = await api()
    .post('/v1/vehicles')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ type: 'motorcycle', brand: 'Honda', model: 'CB150R', year: 2022, engineCc: 150, plate: 'D 1234 ABC' });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  vehicleA = created.body.id;
  assert.equal(created.body.hasPlate, true);
  assert.equal(created.body.plate, undefined);

  const list = await api().get('/v1/vehicles').set('Authorization', `Bearer ${tokenA}`);
  assert.equal(list.status, 200);
  assert.equal(list.body.items[0].plate, undefined);
  assert.equal(list.body.items[0].hasPlate, true);

  const ownerDetail = await api()
    .get(`/v1/vehicles/${vehicleA}?includePlate=true`)
    .set('Authorization', `Bearer ${tokenA}`);
  assert.equal(ownerDetail.status, 200);
  assert.equal(ownerDetail.body.plate, 'D 1234 ABC');

  const otherUser = await api().get(`/v1/vehicles/${vehicleA}`).set('Authorization', `Bearer ${tokenB}`);
  assert.equal(otherUser.status, 404);

  const updated = await api()
    .patch(`/v1/vehicles/${vehicleA}`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ nickname: 'Motor Harian' });
  assert.equal(updated.status, 200);
  assert.equal(updated.body.nickname, 'Motor Harian');

  const second = await api()
    .post('/v1/vehicles')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ type: 'car', brand: 'Toyota', model: 'Avanza' });
  assert.equal(second.status, 201);
  const primary = await api().post(`/v1/vehicles/${second.body.id}/primary`).set('Authorization', `Bearer ${tokenA}`);
  assert.equal(primary.status, 200);
  assert.equal(primary.body.isPrimary, true);
  const first = await api().get(`/v1/vehicles/${vehicleA}`).set('Authorization', `Bearer ${tokenA}`);
  assert.equal(first.body.isPrimary, false);

  const removed = await api().delete(`/v1/vehicles/${second.body.id}`).set('Authorization', `Bearer ${tokenA}`);
  assert.equal(removed.status, 204);
  const afterDelete = await api().get(`/v1/vehicles/${second.body.id}`).set('Authorization', `Bearer ${tokenA}`);
  assert.equal(afterDelete.status, 404);

  const invalid = await api()
    .post('/v1/vehicles')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ type: 'motorcycle', brand: 'X', model: 'Y', year: 1800 });
  assert.equal(invalid.status, 422);
});

test('place search and route provider states', async () => {
  const places = await api().get('/v1/places/search?q=monas').set('Authorization', `Bearer ${tokenA}`);
  assert.equal(places.status, 200);
  assert.equal(places.body.items[0].name, 'Monas');

  const emptyPlaces = await api().get('/v1/places/search?q=kosong').set('Authorization', `Bearer ${tokenA}`);
  assert.equal(emptyPlaces.body.items.length, 0);

  routing.mode = 'ok';
  const preview = await api()
    .post('/v1/routes/preview')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      origin: { lat: -6.2, lng: 106.8 },
      destination: { lat: -6.9, lng: 107.6 },
      waypoints: [{ lat: -6.5, lng: 107.1, label: 'Rest area' }],
      alternatives: true,
    });
  assert.equal(preview.status, 201, JSON.stringify(preview.body));
  assert.equal(preview.body.providerStatus, 'ok');
  assert.equal(preview.body.routes.length, 2);
  assert.ok(preview.body.routes[0].id);
  assert.equal(preview.body.routes[0].geometry.coordinates.length, 3);

  const previewedRouteId = preview.body.routes[0].id;
  const recalculated = await api()
    .post(`/v1/routes/${previewedRouteId}/recalculate`)
    .set('Authorization', `Bearer ${tokenA}`);
  assert.equal(recalculated.status, 201, JSON.stringify(recalculated.body));
  assert.notEqual(recalculated.body.id, previewedRouteId);
  assert.equal(recalculated.body.distanceM, 120_000);
  assert.equal(recalculated.body.provider, 'test-routing');

  const foreignRecalc = await api()
    .post(`/v1/routes/${previewedRouteId}/recalculate`)
    .set('Authorization', `Bearer ${tokenB}`);
  assert.equal(foreignRecalc.status, 404);
  assert.equal(foreignRecalc.body.code, 'ROUTE_NOT_FOUND');

  routing.mode = 'empty';
  const empty = await api()
    .post('/v1/routes/preview')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ origin: { lat: -6.2, lng: 106.8 }, destination: { lat: -6.9, lng: 107.6 } });
  assert.equal(empty.status, 201);
  assert.deepEqual(empty.body.routes, []);
  assert.equal(empty.body.providerStatus, 'empty');

  routing.mode = 'error';
  const failure = await api()
    .post('/v1/routes/preview')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ origin: { lat: -6.2, lng: 106.8 }, destination: { lat: -6.9, lng: 107.6 } });
  assert.equal(failure.status, 503);
  assert.equal(failure.body.code, 'PROVIDER_UNAVAILABLE');
  routing.mode = 'ok';

  const waypoints = Array.from({ length: 8 }, (_, i) => ({ lat: -6.2 - i * 0.01, lng: 106.8 }));
  const tooMany = await api()
    .post('/v1/routes/preview')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ origin: { lat: -6.2, lng: 106.8 }, destination: { lat: -6.9, lng: 107.6 }, waypoints });
  assert.equal(tooMany.status, 422);

  const invalid = await api()
    .post('/v1/routes/preview')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ origin: { lat: 999, lng: 106.8 }, destination: { lat: -6.9, lng: 107.6 } });
  assert.equal(invalid.status, 422);
});

test('trip state machine, GPS noise, recovery, and cross-user isolation', async () => {
  const started = await api()
    .post('/v1/trips')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ vehicleId: vehicleA });
  assert.equal(started.status, 201, JSON.stringify(started.body));
  const tripId = started.body.id;

  const second = await api().post('/v1/trips').set('Authorization', `Bearer ${tokenA}`).send({});
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'ACTIVE_TRIP_EXISTS');
  assert.equal(second.body.activeTripId, tripId);

  const other = await api().get(`/v1/trips/${tripId}`).set('Authorization', `Bearer ${tokenB}`);
  assert.equal(other.status, 404);

  const points = await api()
    .post(`/v1/trips/${tripId}/points`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      points: [
        { seq: 1, lat: -6.2, lng: 106.8, accuracyM: 5, recordedAt: new Date(Date.now() - 180_000).toISOString() },
        { seq: 2, lat: -6.2001, lng: 106.8001, accuracyM: 5, recordedAt: new Date(Date.now() - 175_000).toISOString() },
        { seq: 3, lat: -6.6, lng: 107.3, accuracyM: 5, recordedAt: new Date(Date.now() - 170_000).toISOString(), speedMps: 5 },
        { seq: 4, lat: -6.2002, lng: 106.8002, accuracyM: 500, recordedAt: new Date(Date.now() - 165_000).toISOString() },
        { seq: 5, lat: -6.2003, lng: 106.8003, accuracyM: 8, recordedAt: new Date(Date.now() - 100_000).toISOString() },
      ],
    });
  assert.equal(points.status, 200, JSON.stringify(points.body));
  assert.equal(points.body.accepted, 5);
  const duplicate = await api()
    .post(`/v1/trips/${tripId}/points`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ points: [{ seq: 1, lat: -6.2, lng: 106.8, accuracyM: 5, recordedAt: new Date().toISOString() }] });
  assert.equal(duplicate.body.duplicates, 1);

  const stored = await api().get(`/v1/trips/${tripId}/points`).set('Authorization', `Bearer ${tokenA}`);
  const qualities = stored.body.items.map((p: { quality: string }) => p.quality);
  assert.ok(qualities.includes('spike'));
  assert.ok(qualities.includes('low_accuracy'));
  assert.ok(qualities.includes('gap'));

  const paused = await api().post(`/v1/trips/${tripId}/pause`).set('Authorization', `Bearer ${tokenA}`);
  assert.equal(paused.body.status, 'paused');
  const rejected = await api()
    .post(`/v1/trips/${tripId}/points`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ points: [{ seq: 10, lat: -6.2, lng: 106.8, accuracyM: 5, recordedAt: new Date().toISOString() }] });
  assert.equal(rejected.status, 409);

  const resumed = await api().post(`/v1/trips/${tripId}/resume`).set('Authorization', `Bearer ${tokenA}`);
  assert.equal(resumed.body.status, 'active');
  const finished = await api().post(`/v1/trips/${tripId}/finish`).set('Authorization', `Bearer ${tokenA}`);
  assert.equal(finished.status, 200, JSON.stringify(finished.body));
  assert.equal(finished.body.status, 'finished');
  assert.ok(finished.body.distanceM >= 0);
  assert.ok(finished.body.durationS >= 0);

  const active = await api().get('/v1/trips/active').set('Authorization', `Bearer ${tokenA}`);
  assert.equal(active.body.trip, null);

  const recovery = await api().post('/v1/trips').set('Authorization', `Bearer ${tokenA}`).send({});
  assert.equal(recovery.status, 201);
  const recoveredActive = await api().get('/v1/trips/active').set('Authorization', `Bearer ${tokenA}`);
  assert.equal(recoveredActive.body.trip.id, recovery.body.id);
  const recoveredFinish = await api().post(`/v1/trips/${recovery.body.id}/finish`).set('Authorization', `Bearer ${tokenA}`);
  assert.equal(recoveredFinish.body.status, 'finished');

  const history = await api().get('/v1/trips').set('Authorization', `Bearer ${tokenA}`);
  assert.equal(history.status, 200);
  assert.ok(history.body.items.length >= 2);
});

test('trip summary reports moving duration, maximum speed, and endpoints', async () => {
  const started = await api().post('/v1/trips').set('Authorization', `Bearer ${tokenA}`).send({});
  assert.equal(started.status, 201, JSON.stringify(started.body));
  const tripId = started.body.id;
  const base = Date.now() - 90_000;
  await db.query('UPDATE trips SET started_at = $2 WHERE id = $1', [tripId, new Date(base - 30_000)]);

  const points = await api()
    .post(`/v1/trips/${tripId}/points`)
    .set('Authorization', `Bearer ${tokenA}`)
    .send({
      points: [
        { seq: 1, lat: -6.2, lng: 106.8, accuracyM: 5, speedMps: 0, recordedAt: new Date(base).toISOString() },
        { seq: 2, lat: -6.201, lng: 106.8, accuracyM: 5, speedMps: 10, recordedAt: new Date(base + 10_000).toISOString() },
        { seq: 3, lat: -6.202, lng: 106.8, accuracyM: 5, speedMps: 20, recordedAt: new Date(base + 20_000).toISOString() },
        { seq: 4, lat: -6.203, lng: 106.8, accuracyM: 5, speedMps: 12, recordedAt: new Date(base + 30_000).toISOString() },
      ],
    });
  assert.equal(points.status, 200, JSON.stringify(points.body));
  assert.equal(points.body.accepted, 4);

  const finished = await api().post(`/v1/trips/${tripId}/finish`).set('Authorization', `Bearer ${tokenA}`);
  assert.equal(finished.status, 200, JSON.stringify(finished.body));
  assert.equal(finished.body.movingS, 30);
  assert.equal(finished.body.maxSpeedKph, 72);
  assert.ok(Math.abs(finished.body.startLocation.lat + 6.2) < 1e-9);
  assert.ok(Math.abs(finished.body.startLocation.lng - 106.8) < 1e-9);
  assert.ok(Math.abs(finished.body.endLocation.lat + 6.203) < 1e-9);
  assert.ok(finished.body.distanceM > 300 && finished.body.distanceM < 400);
});

test('chat, hazard, and voice modules are mounted', async () => {
  const hazard = await api()
    .get('/v1/hazards/nearby?lat=-6.2&lng=106.8')
    .set('Authorization', `Bearer ${tokenA}`);
  assert.equal(hazard.status, 200, JSON.stringify(hazard.body));
  assert.deepEqual(hazard.body.items, []);

  // A valid but unknown convoy must reach the module and return its domain 404,
  // not an Express/Nest route-level 404. This catches AppModule wiring regressions.
  const unknownConvoy = '0192f3a0-0000-7000-8000-000000000000';
  const chat = await api()
    .get(`/v1/convoys/${unknownConvoy}/messages`)
    .set('Authorization', `Bearer ${tokenA}`);
  assert.equal(chat.status, 404, JSON.stringify(chat.body));
  assert.equal(chat.body.code, 'CONVOY_NOT_FOUND');

  const voice = await api()
    .post(`/v1/convoys/${unknownConvoy}/voice/token`)
    .set('Authorization', `Bearer ${tokenA}`);
  assert.equal(voice.status, 404, JSON.stringify(voice.body));
  assert.equal(voice.body.code, 'CONVOY_NOT_FOUND');
});
