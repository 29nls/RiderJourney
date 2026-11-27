import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PGliteDatabase } from './pglite.database.js';
import { runMigrations } from '../db/migrate.js';
import { buildTestApp } from './app.factory.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.js';
import { MediaDeletionWorker, enqueueMediaDeletion } from '../media/deletion-outbox.js';
import { MediaService } from '../media/media.service.js';
import { UploadCleanupService } from '../media/upload-cleanup.js';
import { StorageQuotaService } from '../media/storage-quota.js';
import type { ObjectHead, ObjectStorage, ObjectStream } from '../media/object-storage.js';
import { testStorage } from './fake-storage.js';
import { auth, jpegBody, registerUser, sha256Hex, uploadImage, type TestApi } from './phase4.helpers.js';

/**
 * Phase 6.2 storage lifecycle: expired uploads, deletion worker scheduling,
 * quota races, signed GET authorization, and outbox recovery. Storage is the
 * in-memory double here; media.integration.test.ts covers the real SigV4 client
 * against SeaweedFS.
 */

const QUOTA_BYTES = 25_000_000;
const MAX_IMAGE_BYTES = 10_000_000;

let db: PGliteDatabase;
let app: INestApplication;
let api: TestApi;
let config: AppConfig;
let cleanup: UploadCleanupService;
let quota: StorageQuotaService;
let worker: MediaDeletionWorker;
let A: { token: string; id: string };
let B: { token: string; id: string };

const keyFrom = (uploadUrl: string) => new URL(uploadUrl).pathname.replace(/^\//, '');

async function intent(token: string, sizeBytes = 2048, clientMediaId = `p62_${Math.random().toString(36).slice(2)}`) {
  const body = jpegBody(sizeBytes);
  return api
    .post('/v1/media/uploads')
    .set(auth(token))
    .send({
      purpose: 'post_photo',
      contentType: 'image/jpeg',
      sizeBytes: body.length,
      clientMediaId,
      checksumSha256: sha256Hex(body),
    });
}

async function expiryOf(mediaId: string): Promise<Date> {
  const rows = await db.query<{ upload_expires_at: Date }>(
    `SELECT upload_expires_at FROM media_assets WHERE id = $1`,
    [mediaId],
  );
  return new Date(rows[0].upload_expires_at);
}

async function outboxRows(objectKey: string) {
  return db.query<{ id: string; status: string; reason: string; attempts: number }>(
    `SELECT id, status, reason, attempts FROM media_deletion_outbox WHERE object_key = $1`,
    [objectKey],
  );
}

async function statusOf(mediaId: string): Promise<string> {
  const rows = await db.query<{ status: string }>(`SELECT status FROM media_assets WHERE id = $1`, [mediaId]);
  return rows[0].status;
}

/** Storage double that keeps every object but refuses to delete one key. */
class UndeletableStorage implements ObjectStorage {
  constructor(private readonly inner: ObjectStorage, private readonly stuckKey: string) {}
  presignPut(key: string, contentType: string, expiresInSeconds: number) {
    return this.inner.presignPut(key, contentType, expiresInSeconds);
  }
  presignGet(key: string, expiresInSeconds: number) { return this.inner.presignGet(key, expiresInSeconds); }
  head(key: string): Promise<ObjectHead | null> { return this.inner.head(key); }
  openRead(key: string): Promise<ObjectStream> { return this.inner.openRead(key); }
  async delete(key: string): Promise<void> {
    if (key === this.stuckKey) throw new Error('storage refused to delete');
    return this.inner.delete(key);
  }
}

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.PLATE_ENCRYPTION_KEY = Buffer.alloc(32, 23).toString('base64');
  // The intent path refuses to run without configured storage; the values are
  // placeholders for the double, never real credentials.
  process.env.MEDIA_S3_BUCKET = 'test-bucket';
  process.env.MEDIA_S3_ACCESS_KEY = 'test-access';
  process.env.MEDIA_S3_SECRET_KEY = 'test-secret';
  process.env.MEDIA_UPLOAD_TTL_SECONDS = '300';
  process.env.MEDIA_QUOTA_BYTES_DEFAULT = String(QUOTA_BYTES);
  process.env.MEDIA_MAX_BYTES = String(MAX_IMAGE_BYTES);
  process.env.MEDIA_DELETION_MAX_ATTEMPTS = '3';
  process.env.MEDIA_DELETION_BACKOFF_SECONDS = '30';

  db = await PGliteDatabase.create();
  await runMigrations(db);
  const built = await buildTestApp(db);
  app = built.app;
  config = app.get<AppConfig>(APP_CONFIG);
  cleanup = app.get(UploadCleanupService);
  quota = app.get(StorageQuotaService);
  worker = app.get(MediaDeletionWorker);
  api = request(app.getHttpServer() as Parameters<typeof request>[0]);
  A = await registerUser(api, 'phase62_owner', 'Owner 6.2');
  B = await registerUser(api, 'phase62_viewer', 'Viewer 6.2');
  testStorage.clear();
});

after(async () => {
  await cleanup.stopScheduled();
  await worker.stopScheduled();
  await app.close();
  await db.close();
});

test('expired intent with an orphan object is expired and its deletion enqueued', async () => {
  const created = await intent(A.token);
  assert.equal(created.status, 201, JSON.stringify(created.body));
  const mediaId = created.body.id as string;
  const key = keyFrom(created.body.uploadUrl as string);
  testStorage.put(key, jpegBody(2048), 'image/jpeg');

  await db.query(`UPDATE media_assets SET upload_expires_at = now() - interval '1 minute' WHERE id = $1`, [mediaId]);

  const result = await cleanup.cleanupExpired();
  assert.ok(result.expired >= 1);
  assert.equal(await statusOf(mediaId), 'expired');

  const outbox = await outboxRows(key);
  assert.equal(outbox.length, 1, 'exactly one deletion job per orphan key');
  assert.equal(outbox[0].reason, 'expired_upload');
  assert.equal(outbox[0].status, 'pending');

  // The failed attempt no longer holds quota: otherwise one abandoned upload
  // permanently shrinks the account's allowance.
  const afterQuota = await quota.getQuota(A.id);
  const pendingSum = await db.query<{ total: number }>(
    `SELECT COALESCE(SUM(size_bytes), 0)::bigint AS total FROM media_assets WHERE owner_id = $1 AND status = 'pending'`,
    [A.id],
  );
  assert.equal(afterQuota.reservedBytes, Number(pendingSum[0].total));
});

test('expired intent without an object is expired but enqueues no deletion', async () => {
  const created = await intent(A.token);
  const mediaId = created.body.id as string;
  const key = keyFrom(created.body.uploadUrl as string);

  await db.query(`UPDATE media_assets SET upload_expires_at = now() - interval '1 minute' WHERE id = $1`, [mediaId]);

  const result = await cleanup.cleanupExpired();
  assert.ok(result.noObject >= 1);
  assert.equal(await statusOf(mediaId), 'expired');
  assert.equal((await outboxRows(key)).length, 0, 'nothing to delete means no job');
});

test('cleanup never touches ready media, even when its upload window has passed', async () => {
  const ready = await uploadImage(api, A.token, `p62_ready_${Date.now()}`);
  const key = keyFrom(ready.uploadUrl);
  await db.query(`UPDATE media_assets SET upload_expires_at = now() - interval '1 hour' WHERE id = $1`, [ready.id]);

  await cleanup.cleanupExpired();
  assert.equal(await statusOf(ready.id), 'ready');
  assert.equal((await outboxRows(key)).length, 0);
  assert.ok(testStorage.objects.has(key), 'a ready object must not be deleted');
});

test('completion and expiration racing on the same intent settle once', async () => {
  const body = jpegBody(2048);
  const created = await intent(A.token);
  const mediaId = created.body.id as string;
  const key = keyFrom(created.body.uploadUrl as string);
  testStorage.put(key, body, 'image/jpeg');
  await db.query(`UPDATE media_assets SET upload_expires_at = now() - interval '1 second' WHERE id = $1`, [mediaId]);

  const [complete, sweep] = await Promise.all([
    api.post(`/v1/media/uploads/${mediaId}/complete`).set(auth(A.token)),
    cleanup.cleanupExpired(),
  ]);

  assert.ok(sweep.expired >= 1);
  // Whichever side wins, completion must not succeed: either it sees the lapsed
  // window itself (410) or the sweep's CAS already moved the row (409).
  assert.ok([409, 410].includes(complete.status), JSON.stringify(complete.body));
  assert.ok(['MEDIA_UPLOAD_EXPIRED', 'MEDIA_NOT_PENDING'].includes(complete.body.code as string));
  assert.equal(await statusOf(mediaId), 'expired');
  assert.equal((await outboxRows(key)).length, 1, 'the object is claimed for deletion exactly once');
});

test('completion after the deletion worker removed the object reports a missing object, not a success', async () => {
  const created = await intent(A.token);
  const mediaId = created.body.id as string;
  const key = keyFrom(created.body.uploadUrl as string);
  testStorage.put(key, jpegBody(2048), 'image/jpeg');

  // Deletion wins the race; the metadata row is still pending.
  await db.transaction(async (tx) => {
    await enqueueMediaDeletion(tx, [key], 'account_deletion');
  });
  const batch = await worker.processBatch(10);
  assert.ok(batch.succeeded >= 1);
  assert.equal(testStorage.objects.has(key), false);

  const complete = await api.post(`/v1/media/uploads/${mediaId}/complete`).set(auth(A.token));
  assert.equal(complete.status, 409, JSON.stringify(complete.body));
  assert.equal(complete.body.code, 'MEDIA_OBJECT_MISSING');
});

test('the scheduled worker runs on its own and stops on shutdown', async () => {
  const key = `media/scheduled/${Date.now()}.jpg`;
  testStorage.put(key, jpegBody(64), 'image/jpeg');
  await db.transaction(async (tx) => {
    await enqueueMediaDeletion(tx, [key], 'test_scheduled');
  });

  worker.startScheduled(1, 5);
  assert.equal((await worker.status()).scheduled, true);

  const deadline = Date.now() + 15_000;
  while (Date.now() < deadline) {
    const rows = await db.query<{ status: string }>(
      `SELECT status FROM media_deletion_outbox WHERE object_key = $1`,
      [key],
    );
    if (rows[0]?.status === 'done') break;
    await new Promise((resolve) => setTimeout(resolve, 200));
  }
  assert.equal(testStorage.objects.has(key), false, 'the periodic run deleted the object');

  await worker.stopScheduled();
  assert.equal((await worker.status()).scheduled, false);
});

test('two worker instances never delete the same job twice', async () => {
  const keys = Array.from({ length: 6 }, (_, index) => `media/multi/${Date.now()}_${index}.jpg`);
  for (const key of keys) testStorage.put(key, jpegBody(64), 'image/jpeg');
  await db.transaction(async (tx) => {
    await enqueueMediaDeletion(tx, keys, 'test_multi_instance');
  });

  const second = new MediaDeletionWorker(config, db, testStorage);
  const [firstRun, secondRun] = await Promise.all([worker.processBatch(6), second.processBatch(6)]);
  assert.equal(firstRun.succeeded + secondRun.succeeded, keys.length);

  for (const key of keys) {
    const rows = await db.query<{ status: string }>(
      `SELECT status FROM media_deletion_outbox WHERE object_key = $1`,
      [key],
    );
    assert.equal(rows[0].status, 'done');
  }
  for (const key of keys) assert.equal(testStorage.objects.has(key), false);
});

test('a job abandoned by a crashed worker is reclaimed after its lease expires', async () => {
  const key = `media/reclaimed/${Date.now()}.jpg`;
  testStorage.put(key, jpegBody(64), 'image/jpeg');
  await db.transaction(async (tx) => {
    await enqueueMediaDeletion(tx, [key], 'test_recovery');
  });
  // Simulate a worker that claimed the row and then died.
  await db.query(
    `UPDATE media_deletion_outbox SET status = 'processing', attempts = 1, updated_at = now() - interval '11 minutes'
     WHERE object_key = $1`,
    [key],
  );

  const batch = await worker.processBatch(5);
  assert.ok(batch.succeeded >= 1);
  assert.equal(testStorage.objects.has(key), false);
  const rows = await db.query<{ status: string }>(
    `SELECT status FROM media_deletion_outbox WHERE object_key = $1`,
    [key],
  );
  assert.equal(rows[0].status, 'done');
});

test('a job that always fails is dead-lettered after the configured attempts', async () => {
  const key = `media/stuck/${Date.now()}.jpg`;
  testStorage.put(key, jpegBody(64), 'image/jpeg');
  await db.transaction(async (tx) => {
    await enqueueMediaDeletion(tx, [key], 'test_dead_letter');
  });

  const failing = new MediaDeletionWorker(config, db, new UndeletableStorage(testStorage, key));
  let deadLettered = 0;
  for (let attempt = 1; attempt <= config.mediaDeletionMaxAttempts; attempt += 1) {
    // Backoff is honoured in production; the test skips the wait, not the limit.
    await db.query(
      `UPDATE media_deletion_outbox SET next_attempt_at = now() WHERE object_key = $1`,
      [key],
    );
    const result = await failing.processBatch(5);
    deadLettered += result.deadLettered;
  }

  assert.equal(deadLettered, 1, 'the row moves to the dead-letter state exactly once');
  const rows = await db.query<{ status: string; last_error: string | null }>(
    `SELECT status, last_error FROM media_deletion_outbox WHERE object_key = $1`,
    [key],
  );
  assert.equal(rows[0].status, 'failed');
  assert.match(rows[0].last_error ?? '', /refused to delete/);

  const health = await failing.status();
  assert.equal(health.failed, 1, 'operators see the dead-letter count');
  testStorage.objects.delete(key);
});

test('concurrent upload intents cannot together exceed the storage quota', async () => {
  const fresh = await registerUser(api, 'phase62_quota', 'Quota 6.2');
  const size = MAX_IMAGE_BYTES - 1;
  const attempts = 6;

  const responses = await Promise.all(
    Array.from({ length: attempts }, (_, index) =>
      api
        .post('/v1/media/uploads')
        .set(auth(fresh.token))
        .send({
          purpose: 'post_photo',
          contentType: 'image/jpeg',
          sizeBytes: size,
          clientMediaId: `p62_quota_${index}_${Date.now()}`,
          checksumSha256: sha256Hex(Buffer.from(`quota-${index}`)),
        }),
    ),
  );

  const accepted = responses.filter((response) => response.status === 201);
  const rejected = responses.filter((response) => response.status === 409);
  assert.equal(accepted.length + rejected.length, attempts);
  assert.ok(rejected.length > 0, 'the quota must reject at least one concurrent intent');
  for (const response of rejected) assert.equal(response.body.code, 'STORAGE_QUOTA_EXCEEDED');

  const usage = await quota.getQuota(fresh.id);
  assert.equal(usage.reservedBytes, accepted.length * size, 'reservations match the intents that were granted');
  assert.ok(usage.reservedBytes <= QUOTA_BYTES);
  assert.ok(usage.availableBytes >= 0);
});

test('reconciliation rebuilds reservations from the pending intents', async () => {
  const fresh = await registerUser(api, 'phase62_reconcile', 'Reconcile 6.2');
  const granted = await intent(fresh.token, 2048);
  assert.equal(granted.status, 201);

  // Simulate drift from a crash between reservation and row update.
  await db.query(`UPDATE storage_quotas SET reserved_bytes = 999999 WHERE user_id = $1`, [fresh.id]);

  const reconciled = await quota.reconcile(fresh.id);
  const pending = await db.query<{ total: number }>(
    `SELECT COALESCE(SUM(size_bytes), 0)::bigint AS total FROM media_assets WHERE owner_id = $1 AND status = 'pending'`,
    [fresh.id],
  );
  assert.equal(reconciled.reservedBytes, Number(pending[0].total));
});

test('signed GET is scoped to the media, the key holder, and the expiry', async () => {
  const ready = await uploadImage(api, A.token, `p62_signed_${Date.now()}`);

  const signed = await api.get(`/v1/media/${ready.id}/url`).set(auth(A.token));
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  assert.match(signed.body.url as string, /^\/v1\/media\/.+access\?expires=/);

  // The capability URL needs no bearer token: the signature is the grant.
  const accessUrl = signed.body.url as string;
  const granted = await api.get(accessUrl);
  assert.equal(granted.status, 200, JSON.stringify(granted.body));
  assert.ok(granted.body.downloadUrl);

  const expires = new URL(`http://x${accessUrl}`).searchParams.get('expires') as string;
  const signature = new URL(`http://x${accessUrl}`).searchParams.get('signature') as string;

  // A signature minted for another media id must not unlock this object.
  const otherMedia = await uploadImage(api, A.token, `p62_signed_other_${Date.now()}`);
  const crossUse = await api.get(`/v1/media/${otherMedia.id}/access?expires=${expires}&signature=${signature}`);
  assert.equal(crossUse.status, 401, JSON.stringify(crossUse.body));
  assert.equal(crossUse.body.code, 'SIGNED_URL_INVALID');

  const tampered = await api.get(`/v1/media/${ready.id}/access?expires=${expires}&signature=not-the-signature`);
  assert.equal(tampered.status, 401, JSON.stringify(tampered.body));

  const noSignature = await api.get(`/v1/media/${ready.id}/access?expires=${expires}`);
  assert.equal(noSignature.status, 401, JSON.stringify(noSignature.body));
});

test('an expired signed URL is refused even though its signature is valid', async () => {
  const ready = await uploadImage(api, A.token, `p62_expired_url_${Date.now()}`);

  // Mint a URL that lapsed ten seconds ago through the service itself.
  const media = app.get(MediaService);
  const past = await media.signGet(A.id, ready.id, -10);
  const response = await api.get(past.url);
  assert.equal(response.status, 401, JSON.stringify(response.body));
  assert.equal(response.body.code, 'SIGNED_URL_EXPIRED');
});

test('a viewer who may not see the media cannot mint a signed URL', async () => {
  const ready = await uploadImage(api, A.token, `p62_denied_${Date.now()}`);

  const denied = await api.get(`/v1/media/${ready.id}/url`).set(auth(B.token));
  assert.equal(denied.status, 404, JSON.stringify(denied.body));
  assert.equal(denied.body.code, 'MEDIA_NOT_FOUND');

  const anonymous = await api.get(`/v1/media/${ready.id}/url`);
  assert.equal(anonymous.status, 401, 'minting a URL requires authentication');
});

test('a shared-purpose media id stays readable for another viewer', async () => {
  const avatar = await uploadImage(api, A.token, `p62_avatar_${Date.now()}`, 'avatar');
  // Phase 6.3 made non-owner reads fail-closed on scan state, so a shared
  // purpose is only readable once the media is clean.
  await db.query(`UPDATE media_assets SET scan_status = 'clean' WHERE id = $1`, [avatar.id]);
  const signed = await api.get(`/v1/media/${avatar.id}/url`).set(auth(B.token));
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
});

test('completion trusts the stored object, not the intent metadata', async () => {
  const body = jpegBody(2048);
  const created = await intent(A.token, 2048);
  const mediaId = created.body.id as string;
  const key = keyFrom(created.body.uploadUrl as string);
  // A client that lied about the checksum at intent time.
  await db.query(`UPDATE media_assets SET checksum_sha256 = $2 WHERE id = $1`, [mediaId, 'a'.repeat(64)]);
  testStorage.put(key, body, 'image/jpeg');

  const complete = await api.post(`/v1/media/uploads/${mediaId}/complete`).set(auth(A.token));
  assert.equal(complete.status, 409, JSON.stringify(complete.body));
  assert.equal(complete.body.code, 'MEDIA_CHECKSUM_MISMATCH');
  assert.equal(await statusOf(mediaId), 'rejected');
});

test('a mismatched content type is rejected instead of accepted', async () => {
  const created = await intent(A.token, 2048);
  const mediaId = created.body.id as string;
  const key = keyFrom(created.body.uploadUrl as string);
  testStorage.put(key, jpegBody(2048), 'image/png');

  const complete = await api.post(`/v1/media/uploads/${mediaId}/complete`).set(auth(A.token));
  assert.equal(complete.status, 409, JSON.stringify(complete.body));
  assert.equal(complete.body.code, 'MEDIA_CONTENT_MISMATCH');
});

test('the quota endpoint reports derived usage for the caller only', async () => {
  const fresh = await registerUser(api, 'phase62_quota_read', 'Quota Read 6.2');
  const ready = await uploadImage(api, fresh.token, `p62_quota_ready_${Date.now()}`);
  const rows = await db.query<{ size_bytes: number }>(`SELECT size_bytes FROM media_assets WHERE id = $1`, [ready.id]);

  const me = await api.get('/v1/media/quota').set(auth(fresh.token));
  assert.equal(me.status, 200, JSON.stringify(me.body));
  assert.equal(me.body.usedBytes, Number(rows[0].size_bytes));
  assert.equal(me.body.quotaBytes, QUOTA_BYTES);

  const anonymous = await api.get('/v1/media/quota');
  assert.equal(anonymous.status, 401);
});
