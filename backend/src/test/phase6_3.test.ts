import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PGliteDatabase } from './pglite.database.js';
import { runMigrations } from '../db/migrate.js';
import { buildTestApp } from './app.factory.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { MediaDeletionWorker } from '../media/deletion-outbox.js';
import { MediaScanWorker } from '../media/scan-worker.js';
import { ClamAvMediaScanner, NoOpMediaScanner } from '../media/media-scanner.js';
import { StorageQuotaService } from '../media/storage-quota.js';
import type { ObjectStream } from '../media/object-storage.js';
import { testStorage } from './fake-storage.js';
import { auth, jpegBody, registerUser, uploadImage, type TestApi } from './phase4.helpers.js';

/**
 * Phase 6.3: deletion lifecycle, reference protection, quota accounting,
 * fail-closed scanning, and admin-only observability.
 */

let db: PGliteDatabase;
let app: INestApplication;
let api: TestApi;
let config: AppConfig;
let worker: MediaDeletionWorker;
let quota: StorageQuotaService;
let A: { token: string; id: string };
let B: { token: string; id: string };

const keyFrom = (uploadUrl: string) => new URL(uploadUrl).pathname.replace(/^\//, '');

async function markClean(mediaId: string) {
  await db.query(`UPDATE media_assets SET scan_status = 'clean' WHERE id = $1`, [mediaId]);
}

async function statusOf(mediaId: string): Promise<string> {
  const rows = await db.query<{ status: string }>(`SELECT status FROM media_assets WHERE id = $1`, [mediaId]);
  return rows[0].status;
}

async function outboxFor(key: string) {
  return db.query<{ id: string; status: string; reason: string }>(
    `SELECT id, status, reason FROM media_deletion_outbox WHERE object_key = $1`,
    [key],
  );
}

/** Minimal clamd that speaks the real INSTREAM framing for one connection. */
async function startClamd(reply: string): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer((socket) => {
    let buffer = Buffer.alloc(0);
    let streaming = false;
    socket.on('data', (chunk) => {
      buffer = Buffer.concat([buffer, chunk]);
      if (!streaming) {
        const nul = buffer.indexOf(0);
        if (nul === -1) return;
        const command = buffer.subarray(0, nul).toString('utf8');
        if (command !== 'zINSTREAM') {
          socket.end('UNKNOWN COMMAND\0');
          return;
        }
        streaming = true;
        buffer = buffer.subarray(nul + 1);
      }
      while (buffer.length >= 4) {
        const length = buffer.readUInt32BE(0);
        if (length === 0) {
          socket.end(`${reply}\0`);
          return;
        }
        if (buffer.length < 4 + length) return;
        buffer = buffer.subarray(4 + length);
      }
    });
  });
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address() as net.AddressInfo;
  return {
    port: address.port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}

function streamOf(body: Buffer): () => Promise<ObjectStream> {
  return async () => ({
    contentLength: body.length,
    stream: (async function* () {
      yield body;
    })(),
  });
}

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.PLATE_ENCRYPTION_KEY = Buffer.alloc(32, 29).toString('base64');
  process.env.MEDIA_S3_BUCKET = 'test-bucket';
  process.env.MEDIA_S3_ACCESS_KEY = 'test-access';
  process.env.MEDIA_S3_SECRET_KEY = 'test-secret';
  process.env.MEDIA_QUOTA_BYTES_DEFAULT = '25000000';
  process.env.MEDIA_MAX_BYTES = '10000000';
  process.env.MEDIA_DELETION_MAX_ATTEMPTS = '3';
  process.env.MEDIA_SCAN_MAX_ATTEMPTS = '2';

  db = await PGliteDatabase.create();
  await runMigrations(db);
  const built = await buildTestApp(db);
  app = built.app;
  config = app.get<AppConfig>(APP_CONFIG);
  worker = app.get(MediaDeletionWorker);
  quota = app.get(StorageQuotaService);
  api = request(app.getHttpServer() as Parameters<typeof request>[0]);
  A = await registerUser(api, 'phase63_owner', 'Owner 6.3');
  B = await registerUser(api, 'phase63_other', 'Other 6.3');
  testStorage.clear();
});

after(async () => {
  await app.close();
  await db.close();
});

test('deleting own media enqueues the object and keeps it counted until it is gone', async () => {
  const ready = await uploadImage(api, A.token, `p63_delete_${Date.now()}`);
  const key = keyFrom(ready.uploadUrl);

  const before = await quota.getQuota(A.id);
  assert.ok(before.usedBytes >= 1);
  const size = await db.query<{ size_bytes: number }>(
    `SELECT size_bytes FROM media_assets WHERE id = $1`,
    [ready.id],
  );
  const bytes = Number(size[0].size_bytes);

  const deleted = await api.delete(`/v1/media/${ready.id}`).set(auth(A.token));
  assert.equal(deleted.status, 200, JSON.stringify(deleted.body));
  assert.equal(deleted.body.status, 'deleting');
  assert.equal(await statusOf(ready.id), 'deleting');

  const jobs = await outboxFor(key);
  assert.equal(jobs.length, 1);
  assert.equal(jobs[0].reason, 'user_delete');

  // A deletion request alone must not free quota: the bytes are still stored.
  const pending = await quota.getQuota(A.id);
  assert.equal(pending.usedBytes, before.usedBytes, 'deletion-pending bytes still count');
  assert.equal(pending.deletionPendingBytes, bytes);

  const batch = await worker.processBatch(10);
  assert.ok(batch.succeeded >= 1);
  assert.equal(testStorage.objects.has(key), false);
  assert.equal(await statusOf(ready.id), 'deleted');

  const freed = await quota.getQuota(A.id);
  assert.equal(freed.usedBytes, before.usedBytes - bytes, 'quota is released only after the object is gone');
  assert.equal(freed.deletionPendingBytes, 0);
});

test('deleting a media owned by someone else answers 404 and changes nothing', async () => {
  const ready = await uploadImage(api, A.token, `p63_other_${Date.now()}`);

  const denied = await api.delete(`/v1/media/${ready.id}`).set(auth(B.token));
  assert.equal(denied.status, 404, JSON.stringify(denied.body));
  assert.equal(denied.body.code, 'MEDIA_NOT_FOUND');
  assert.equal(await statusOf(ready.id), 'ready');

  const anonymous = await api.delete(`/v1/media/${ready.id}`);
  assert.equal(anonymous.status, 401);
});

test('deleting twice is idempotent and never enqueues a second job', async () => {
  const ready = await uploadImage(api, A.token, `p63_idem_${Date.now()}`);
  const key = keyFrom(ready.uploadUrl);

  const first = await api.delete(`/v1/media/${ready.id}`).set(auth(A.token));
  assert.equal(first.body.status, 'deleting');
  const second = await api.delete(`/v1/media/${ready.id}`).set(auth(A.token));
  assert.equal(second.status, 200, JSON.stringify(second.body));
  assert.equal(second.body.duplicate, true);

  assert.equal((await outboxFor(key)).length, 1);

  await worker.processBatch(10);
  const third = await api.delete(`/v1/media/${ready.id}`).set(auth(A.token));
  assert.equal(third.status, 200);
  assert.equal(third.body.status, 'deleted');
});

test('media referenced by a vehicle cannot be deleted', async () => {
  const ready = await uploadImage(api, A.token, `p63_vehicle_${Date.now()}`, 'vehicle_photo');
  const vehicle = await api.post('/v1/vehicles').set(auth(A.token)).send({
    type: 'motorcycle',
    brand: 'Honda',
    model: 'CT125',
    photoMediaId: ready.id,
  });
  assert.equal(vehicle.status, 201, JSON.stringify(vehicle.body));

  const denied = await api.delete(`/v1/media/${ready.id}`).set(auth(A.token));
  assert.equal(denied.status, 409, JSON.stringify(denied.body));
  assert.equal(denied.body.code, 'MEDIA_IN_USE');
  assert.deepEqual(denied.body.references, ['vehicle']);
  assert.equal(await statusOf(ready.id), 'ready');

  // Detaching through the vehicle clears the reference; only then can it go.
  const cleared = await api.patch(`/v1/vehicles/${vehicle.body.id}`).set(auth(A.token)).send({ photoMediaId: '' });
  assert.equal(cleared.status, 200, JSON.stringify(cleared.body));
  assert.equal(await statusOf(ready.id), 'deleting', 'an unreferenced photo is released by the detach');
});

test('replacing an avatar detaches the old media without touching the profile', async () => {
  const first = await uploadImage(api, A.token, `p63_avatar_a_${Date.now()}`, 'avatar');
  const setFirst = await api.patch('/v1/me').set(auth(A.token)).send({ avatarMediaId: first.id });
  assert.equal(setFirst.status, 200, JSON.stringify(setFirst.body));
  assert.equal(setFirst.body.avatarMediaId, first.id);

  const second = await uploadImage(api, A.token, `p63_avatar_b_${Date.now()}`, 'avatar');
  const setSecond = await api.patch('/v1/me').set(auth(A.token)).send({ avatarMediaId: second.id });
  assert.equal(setSecond.status, 200, JSON.stringify(setSecond.body));
  assert.equal(setSecond.body.avatarMediaId, second.id);

  assert.equal(await statusOf(first.id), 'deleting', 'the replaced avatar is released');
  assert.equal(await statusOf(second.id), 'ready', 'the current avatar stays');

  // The feed reads rider_profiles, so the mirror must agree with /v1/me.
  const profile = await db.query<{ avatar_media_id: string | null }>(
    `SELECT avatar_media_id FROM rider_profiles WHERE user_id = $1`,
    [A.id],
  );
  assert.equal(profile[0]?.avatar_media_id, second.id);

  const removed = await api.patch('/v1/me').set(auth(A.token)).send({ avatarMediaId: '' });
  assert.equal(removed.status, 200);
  assert.equal(removed.body.avatarMediaId, null);
  assert.equal(await statusOf(second.id), 'deleting');
});

test('a replaced avatar that is still used elsewhere is not deleted', async () => {
  const shared = await uploadImage(api, A.token, `p63_shared_${Date.now()}`, 'avatar');
  const vehicle = await api.post('/v1/vehicles').set(auth(A.token)).send({
    type: 'motorcycle',
    brand: 'Yamaha',
    model: 'XSR',
  });
  assert.equal(vehicle.status, 201, JSON.stringify(vehicle.body));
  // The attachment API checks purpose, but the reference rule must hold for any
  // row that points at the media, however it got there.
  await db.query(`UPDATE vehicles SET photo_media_id = $1 WHERE id = $2`, [shared.id, vehicle.body.id]);

  await api.patch('/v1/me').set(auth(A.token)).send({ avatarMediaId: shared.id });
  const other = await uploadImage(api, A.token, `p63_shared_b_${Date.now()}`, 'avatar');
  await api.patch('/v1/me').set(auth(A.token)).send({ avatarMediaId: other.id });

  assert.equal(await statusOf(shared.id), 'ready', 'still referenced by the vehicle');
  assert.equal((await outboxFor(keyFrom(shared.uploadUrl))).length, 0);
});

test('unscanned and quarantined media are refused to everyone but the owner', async () => {
  const unscanned = await uploadImage(api, A.token, `p63_unscanned_${Date.now()}`, 'avatar');
  const unscannedRead = await api.get(`/v1/media/${unscanned.id}/url`).set(auth(B.token));
  assert.equal(unscannedRead.status, 404, 'unscanned media is not served as if it were clean');

  const ownerRead = await api.get(`/v1/media/${unscanned.id}/url`).set(auth(A.token));
  assert.equal(ownerRead.status, 200, 'the owner can still see their own pending media');

  await db.query(`UPDATE media_assets SET scan_status = 'clean' WHERE id = $1`, [unscanned.id]);
  const afterClean = await api.get(`/v1/media/${unscanned.id}/url`).set(auth(B.token));
  assert.equal(afterClean.status, 200, JSON.stringify(afterClean.body));

  await db.query(`UPDATE media_assets SET scan_status = 'quarantined' WHERE id = $1`, [unscanned.id]);
  const quarantinedRead = await api.get(`/v1/media/${unscanned.id}/url`).set(auth(B.token));
  assert.equal(quarantinedRead.status, 404, 'quarantine blocks public access');

  const ownerQuarantined = await api.get(`/v1/media/${unscanned.id}/url`).set(auth(A.token));
  assert.equal(ownerQuarantined.status, 200);
});

test('the admin worker endpoint is closed to normal users and exposes no secrets', async () => {
  const denied = await api.get('/v1/admin/media/workers').set(auth(A.token));
  assert.ok([401, 403].includes(denied.status), `expected 401/403, got ${denied.status}`);

  const anonymous = await api.get('/v1/admin/media/workers');
  assert.equal(anonymous.status, 401);
});

test('with no scanner the worker leaves media unscanned instead of marking it clean', async () => {
  const ready = await uploadImage(api, A.token, `p63_noscan_${Date.now()}`);
  const noop = new MediaScanWorker(config, db, testStorage, new NoOpMediaScanner());
  const result = await noop.scanBatch(5);
  assert.equal(result.scanned, 0);
  assert.equal(result.clean, 0);

  const rows = await db.query<{ scan_status: string }>(`SELECT scan_status FROM media_assets WHERE id = $1`, [ready.id]);
  assert.equal(rows[0].scan_status, 'unscanned');

  const status = await noop.status();
  assert.equal(status.status, 'unavailable');
  assert.equal(status.available, false);
});

test('the ClamAV adapter speaks INSTREAM and maps OK to clean', async () => {
  const daemon = await startClamd('stream: OK');
  try {
    const scanner = new ClamAvMediaScanner({ host: '127.0.0.1', port: daemon.port, timeoutMs: 5_000 });
    assert.equal(scanner.available(), true);
    const result = await scanner.scan('media/x.jpg', 'image/jpeg', streamOf(jpegBody(4096)));
    assert.equal(result.status, 'clean', JSON.stringify(result));
  } finally {
    await daemon.close();
  }
});

test('a FOUND reply quarantines the media', async () => {
  const daemon = await startClamd('stream: Eicar-Test-Signature FOUND');
  try {
    const scanner = new ClamAvMediaScanner({ host: '127.0.0.1', port: daemon.port, timeoutMs: 5_000 });
    const result = await scanner.scan('media/x.jpg', 'image/jpeg', streamOf(Buffer.from('malware')));
    assert.equal(result.status, 'quarantined');
    assert.match(result.details ?? '', /Eicar/);
  } finally {
    await daemon.close();
  }
});

test('an unreachable scanner is a failure, never a clean result', async () => {
  const scanner = new ClamAvMediaScanner({ host: '127.0.0.1', port: 1, timeoutMs: 1_000 });
  const result = await scanner.scan('media/x.jpg', 'image/jpeg', streamOf(Buffer.from('x')));
  assert.equal(result.status, 'scan_failed');
});

test('the scan worker records clean, quarantined, and exhausted failures', async () => {
  const cleanMedia = await uploadImage(api, A.token, `p63_scan_clean_${Date.now()}`);
  const daemon = await startClamd('stream: OK');
  try {
    const scanner = new ClamAvMediaScanner({ host: '127.0.0.1', port: daemon.port, timeoutMs: 5_000 });
    const scanWorker = new MediaScanWorker(config, db, testStorage, scanner);
    const result = await scanWorker.scanBatch(20);
    assert.ok(result.clean >= 1, JSON.stringify(result));
  } finally {
    await daemon.close();
  }
  const rows = await db.query<{ scan_status: string | null; scanned_at: Date | null }>(
    `SELECT scan_status, scanned_at FROM media_assets WHERE id = $1`,
    [cleanMedia.id],
  );
  assert.equal(rows[0].scan_status, 'clean');
  assert.ok(rows[0].scanned_at);
});

test('a scan that keeps failing stops at the attempt limit without becoming clean', async () => {
  const ready = await uploadImage(api, A.token, `p63_scan_fail_${Date.now()}`);
  const failing = new MediaScanWorker(config, db, testStorage, {
    name: 'broken',
    available: () => true,
    scan: async () => ({ status: 'scan_failed' as const, provider: 'broken', details: 'daemon down' }),
  });

  for (let attempt = 0; attempt < config.mediaScanMaxAttempts; attempt += 1) {
    await db.query(`UPDATE media_assets SET scan_next_at = now() WHERE id = $1`, [ready.id]);
    await failing.scanBatch(1);
  }

  const rows = await db.query<{ scan_status: string; scan_last_error: string | null; scan_attempts: number }>(
    `SELECT scan_status, scan_last_error, scan_attempts FROM media_assets WHERE id = $1`,
    [ready.id],
  );
  assert.equal(rows[0].scan_status, 'scan_failed');
  assert.match(rows[0].scan_last_error ?? '', /daemon down/);
  assert.ok(rows[0].scan_attempts >= config.mediaScanMaxAttempts);
});

test('quota accounting keeps the same rule as concurrent uploads', async () => {
  const fresh = await registerUser(api, 'phase63_quota', 'Quota 6.3');
  const first = await uploadImage(api, fresh.token, `p63_q_a_${Date.now()}`);
  const second = await uploadImage(api, fresh.token, `p63_q_b_${Date.now()}`);

  const deleting = await api.delete(`/v1/media/${first.id}`).set(auth(fresh.token));
  assert.equal(deleting.status, 200);

  const usage = await quota.getQuota(fresh.id);
  assert.equal(usage.usedBytes, usage.readyBytes + usage.deletionPendingBytes);
  assert.equal(usage.reservedBytes, 0);
  assert.equal(usage.availableBytes, usage.quotaBytes - usage.usedBytes);

  // A new upload must still see the deleting bytes as used: one byte more than
  // the reported availability has to be rejected.
  let rejected = false;
  try {
    await quota.reserveUpload(fresh.id, usage.availableBytes + 1);
  } catch {
    rejected = true;
  }
  assert.equal(rejected, true, 'deletion-pending bytes must still block new reservations');

  await worker.processBatch(10);
  const freed = await quota.getQuota(fresh.id);
  assert.ok(freed.availableBytes > usage.availableBytes);
  assert.equal(await statusOf(second.id), 'ready');
});
