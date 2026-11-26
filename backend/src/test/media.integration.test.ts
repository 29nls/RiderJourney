import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import { createHash } from 'node:crypto';
import { v7 as uuidv7 } from 'uuid';
import type { INestApplication } from '@nestjs/common';
import {
  CreateBucketCommand,
  DeleteObjectCommand,
  HeadObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { PGliteDatabase } from './pglite.database.js';
import { runMigrations } from '../db/migrate.js';
import { buildTestApp } from './app.factory.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.js';
import { MediaDeletionWorker, enqueueMediaDeletion } from '../media/deletion-outbox.js';
import { OBJECT_STORAGE, type ObjectStorage } from '../media/object-storage.js';
import { PrivacyService } from '../ops/privacy.service.js';
import { auth, registerUser, type TestApi } from './phase4.helpers.js';

/**
 * Runs only when a real S3-compatible server is configured:
 *   MEDIA_S3_INTEGRATION=1 MEDIA_S3_ENDPOINT=http://127.0.0.1:8333 \
 *   MEDIA_S3_BUCKET=rj-media-it MEDIA_S3_ACCESS_KEY=... MEDIA_S3_SECRET_KEY=... \
 *   node --test dist/test/media.integration.test.js
 * No mocked storage client is used here.
 */
const ENABLED = process.env.MEDIA_S3_INTEGRATION === '1';
const it = ENABLED ? test : test.skip;

const ENDPOINT = process.env.MEDIA_S3_ENDPOINT ?? 'http://127.0.0.1:8333';
const BUCKET = process.env.MEDIA_S3_BUCKET ?? 'rj-media-it';
const REGION = process.env.MEDIA_S3_REGION ?? 'us-east-1';
const ACCESS_KEY = process.env.MEDIA_S3_ACCESS_KEY ?? '';
const SECRET_KEY = process.env.MEDIA_S3_SECRET_KEY ?? '';

let db: PGliteDatabase;
let app: INestApplication;
let api: TestApi;
let config: AppConfig;
let storage: ObjectStorage;
let worker: MediaDeletionWorker;
let privacy: PrivacyService;
let s3: S3Client;
let A: { token: string; id: string };
let B: { token: string; id: string };

const JPEG_HEAD = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00]);
const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);

function jpeg(size = 256, fill = 0x21): Buffer {
  return Buffer.concat([JPEG_HEAD, Buffer.alloc(Math.max(0, size - JPEG_HEAD.length), fill)]);
}

const sha256 = (body: Buffer) => createHash('sha256').update(body).digest('hex');
const keyFrom = (url: string) => new URL(url).pathname.split('/').slice(2).join('/');

async function put(url: string, body: Buffer, headers: Record<string, string> = {}) {
  return fetch(url, {
    method: 'PUT',
    headers: { 'content-type': 'image/jpeg', 'if-none-match': '*', ...headers },
    body,
  });
}

async function createIntent(token: string, body: Buffer, purpose = 'post_photo', contentType = 'image/jpeg', checksum = sha256(body)) {
  return api.post('/v1/media/uploads').set(auth(token)).send({
    purpose,
    contentType,
    sizeBytes: body.length,
    clientMediaId: `it_${uuidv7()}`,
    checksumSha256: checksum,
  });
}

async function readyMedia(user: { token: string }, body = jpeg()) {
  const intent = await createIntent(user.token, body);
  assert.equal(intent.status, 201, JSON.stringify(intent.body));
  const upload = await put(intent.body.uploadUrl as string, body);
  assert.equal(upload.status, 200, await upload.text());
  const complete = await api.post(`/v1/media/uploads/${intent.body.id}/complete`).set(auth(user.token));
  assert.equal(complete.status, 200, JSON.stringify(complete.body));
  return { id: intent.body.id as string, key: keyFrom(intent.body.uploadUrl as string), body };
}

async function objectExists(key: string): Promise<boolean> {
  try {
    await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: key }));
    return true;
  } catch (error) {
    if ((error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode === 404) return false;
    throw error;
  }
}

before(async () => {
  if (!ENABLED) return;
  process.env.NODE_ENV = 'test';
  process.env.PLATE_ENCRYPTION_KEY = Buffer.alloc(32, 17).toString('base64');
  process.env.MEDIA_S3_ENDPOINT = ENDPOINT;
  process.env.MEDIA_S3_BUCKET = BUCKET;
  process.env.MEDIA_S3_REGION = REGION;
  process.env.MEDIA_S3_ACCESS_KEY = ACCESS_KEY;
  process.env.MEDIA_S3_SECRET_KEY = SECRET_KEY;
  process.env.MEDIA_S3_FORCE_PATH_STYLE = 'true';
  process.env.MEDIA_UPLOAD_TTL_SECONDS = '300';
  process.env.MEDIA_DELETION_MAX_ATTEMPTS = '3';
  process.env.MEDIA_DELETION_BACKOFF_SECONDS = '30';

  s3 = new S3Client({
    endpoint: ENDPOINT,
    region: REGION,
    forcePathStyle: true,
    credentials: { accessKeyId: ACCESS_KEY, secretAccessKey: SECRET_KEY },
    requestChecksumCalculation: 'WHEN_REQUIRED',
    responseChecksumValidation: 'WHEN_REQUIRED',
  });
  try {
    await s3.send(new CreateBucketCommand({ Bucket: BUCKET }));
  } catch (error) {
    const status = (error as { $metadata?: { httpStatusCode?: number } }).$metadata?.httpStatusCode;
    if (status !== 409) throw error;
  }

  db = await PGliteDatabase.create();
  await runMigrations(db);
  const built = await buildTestApp(db, undefined, undefined, { realStorage: true });
  app = built.app;
  config = app.get<AppConfig>(APP_CONFIG);
  storage = app.get<ObjectStorage>(OBJECT_STORAGE);
  worker = app.get(MediaDeletionWorker);
  privacy = app.get(PrivacyService);
  api = request(app.getHttpServer() as Parameters<typeof request>[0]) as unknown as TestApi;
  A = await registerUser(api, 'media_alpha', 'Media Alpha');
  B = await registerUser(api, 'media_bravo', 'Media Bravo');
});

after(async () => {
  if (!app) return;
  await app.close();
  await db.close();
});

it('presigned SigV4 upload and HEAD verification make media ready', async () => {
  const body = jpeg(300);
  const intent = await createIntent(A.token, body);
  assert.equal(intent.status, 201, JSON.stringify(intent.body));
  assert.match(intent.body.uploadUrl, /X-Amz-Algorithm=AWS4-HMAC-SHA256/);
  assert.equal(new URL(intent.body.uploadUrl as string).searchParams.get('X-Amz-SignedHeaders'), 'content-type;host;if-none-match');
  // The key is server-generated and namespaced to the owner.
  assert.match(keyFrom(intent.body.uploadUrl as string), new RegExp(`^media/${A.id}/[0-9a-f-]{36}\\.jpg$`));

  assert.equal((await put(intent.body.uploadUrl as string, body)).status, 200);
  const head = await s3.send(new HeadObjectCommand({ Bucket: BUCKET, Key: keyFrom(intent.body.uploadUrl as string) }));
  assert.equal(head.ContentLength, body.length);

  const complete = await api.post(`/v1/media/uploads/${intent.body.id}/complete`).set(auth(A.token));
  assert.equal(complete.status, 200, JSON.stringify(complete.body));
  assert.equal(complete.body.status, 'ready');

  const signed = await api.get(`/v1/media/${intent.body.id}/url`).set(auth(A.token));
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  const access = await api.get(signed.body.url as string);
  assert.equal(access.status, 200, JSON.stringify(access.body));
  assert.ok(access.body.downloadUrl);
  const downloaded = await fetch(access.body.downloadUrl as string);
  assert.equal(downloaded.status, 200);
  assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), body);
});

it('rejects a tampered signature and a wrong signed content type', async () => {
  const body = jpeg();
  const intent = await createIntent(A.token, body);
  const tampered = new URL(intent.body.uploadUrl as string);
  tampered.searchParams.set('X-Amz-Signature', '0'.repeat(64));
  assert.equal((await put(tampered.toString(), body)).status, 403);
  assert.equal((await put(intent.body.uploadUrl as string, body, { 'content-type': 'image/png' })).status, 403);
  const otherKey = new URL(intent.body.uploadUrl as string);
  otherKey.pathname = otherKey.pathname.replace(`/media/${A.id}/`, `/media/${B.id}/`);
  assert.equal((await put(otherKey.toString(), body)).status, 403);

  const complete = await api.post(`/v1/media/uploads/${intent.body.id}/complete`).set(auth(A.token));
  assert.equal(complete.status, 409);
  assert.equal(complete.body.code, 'MEDIA_OBJECT_MISSING');
});

it('rejects completion after the intent expires', async () => {
  const body = jpeg();
  const intent = await createIntent(A.token, body);
  assert.equal((await put(intent.body.uploadUrl as string, body)).status, 200);
  await db.query(`UPDATE media_assets SET upload_expires_at = now() - interval '1 minute' WHERE id = $1`, [intent.body.id]);
  const complete = await api.post(`/v1/media/uploads/${intent.body.id}/complete`).set(auth(A.token));
  assert.equal(complete.status, 410);
  assert.equal(complete.body.code, 'MEDIA_UPLOAD_EXPIRED');
});

it('rejects a missing object, wrong length, wrong type, and wrong checksum', async () => {
  const missing = await createIntent(A.token, jpeg());
  const absent = await api.post(`/v1/media/uploads/${missing.body.id}/complete`).set(auth(A.token));
  assert.equal(absent.status, 409);
  assert.equal(absent.body.code, 'MEDIA_OBJECT_MISSING');

  const declared = jpeg(300);
  const longIntent = await createIntent(A.token, declared);
  assert.equal((await put(longIntent.body.uploadUrl as string, jpeg(301))).status, 200);
  const longComplete = await api.post(`/v1/media/uploads/${longIntent.body.id}/complete`).set(auth(A.token));
  assert.equal(longComplete.status, 409);
  assert.equal(longComplete.body.code, 'MEDIA_SIZE_MISMATCH');

  const png = Buffer.concat([PNG_HEAD, Buffer.alloc(16)]);
  const typeIntent = await createIntent(A.token, png);
  assert.equal((await put(typeIntent.body.uploadUrl as string, png)).status, 200);
  const typeComplete = await api.post(`/v1/media/uploads/${typeIntent.body.id}/complete`).set(auth(A.token));
  assert.equal(typeComplete.status, 409);
  assert.equal(typeComplete.body.code, 'MEDIA_CONTENT_MISMATCH');

  const honest = jpeg(300);
  const tampered = Buffer.from(honest);
  tampered[30] ^= 0xff;
  const checksumIntent = await createIntent(A.token, honest);
  assert.equal((await put(checksumIntent.body.uploadUrl as string, tampered)).status, 200);
  const checksumComplete = await api.post(`/v1/media/uploads/${checksumIntent.body.id}/complete`).set(auth(A.token));
  assert.equal(checksumComplete.status, 409);
  assert.equal(checksumComplete.body.code, 'MEDIA_CHECKSUM_MISMATCH');
});

it('enforces ownership and treats duplicate completion as idempotent', async () => {
  const media = await readyMedia(A);
  const duplicate = await api.post(`/v1/media/uploads/${media.id}/complete`).set(auth(A.token));
  assert.equal(duplicate.status, 200);
  assert.equal(duplicate.body.duplicate, true);

  const foreignComplete = await api.post(`/v1/media/uploads/${media.id}/complete`).set(auth(B.token));
  assert.equal(foreignComplete.status, 404);
  assert.equal((await api.get(`/v1/media/${media.id}/url`).set(auth(B.token))).status, 404);
});

it('prevents overwriting a finished object through a replayed upload URL', async () => {
  const body = jpeg();
  const intent = await createIntent(A.token, body);
  const url = intent.body.uploadUrl as string;
  assert.equal((await put(url, body)).status, 200);
  assert.equal((await put(url, body)).status, 412);
  await api.post(`/v1/media/uploads/${intent.body.id}/complete`).set(auth(A.token));
  const again = await api.post('/v1/media/uploads').set(auth(A.token)).send({
    purpose: 'post_photo', contentType: 'image/jpeg', sizeBytes: body.length,
    clientMediaId: `it_${uuidv7()}`, checksumSha256: sha256(body),
  });
  assert.equal(again.status, 201);
  assert.notEqual(keyFrom(again.body.uploadUrl as string), keyFrom(url));
});

it('deletes objects through the outbox and treats a second enqueue as a duplicate', async () => {
  const media = await readyMedia(A);
  assert.equal(await enqueueMediaDeletion(db, [media.key], 'integration_test'), 1);
  assert.equal(await enqueueMediaDeletion(db, [media.key], 'integration_test'), 0);
  const result = await worker.processBatch(10);
  assert.equal(result.succeeded, 1);
  assert.equal(await objectExists(media.key), false);
  const status = await worker.status();
  assert.equal(status.failed, 0);
  assert.ok(status.done >= 1);
});

it('worker treats an already missing object as a successful deletion', async () => {
  const key = `media/${A.id}/${uuidv7()}.jpg`;
  await db.query(`INSERT INTO media_deletion_outbox (id, object_key, reason) VALUES ($1, $2, $3)`, [uuidv7(), key, 'missing_test']);
  const result = await worker.processBatch(10);
  assert.equal(result.succeeded, 1);
  const rows = await db.query<{ status: string }>(`SELECT status FROM media_deletion_outbox WHERE object_key = $1`, [key]);
  assert.equal(rows[0]?.status, 'done');
});

it('retries a transient storage failure and succeeds on the next pass', async () => {
  const media = await readyMedia(A);
  let failures = 0;
  const flaky: ObjectStorage = {
    presignPut: (key, type, ttl) => storage.presignPut(key, type, ttl),
    presignGet: (key, ttl) => storage.presignGet(key, ttl),
    head: (key) => storage.head(key),
    openRead: (key) => storage.openRead(key),
    delete: async (key) => {
      if (failures === 0) {
        failures += 1;
        throw new Error('injected transient storage failure');
      }
      await storage.delete(key);
    },
  };
  await db.query(`INSERT INTO media_deletion_outbox (id, object_key, reason) VALUES ($1, $2, $3)`, [uuidv7(), media.key, 'retry_test']);
  const flakyWorker = new MediaDeletionWorker(config, db, flaky);
  const first = await flakyWorker.processBatch(10);
  assert.equal(first.retrying, 1);
  const pending = await db.query<{ status: string; attempts: number }>(`SELECT status, attempts FROM media_deletion_outbox WHERE object_key = $1`, [media.key]);
  assert.equal(pending[0]?.status, 'pending');
  assert.equal(pending[0]?.attempts, 1);
  assert.equal(await objectExists(media.key), true);
  await db.query(`UPDATE media_deletion_outbox SET next_attempt_at = now() WHERE object_key = $1`, [media.key]);
  const second = await flakyWorker.processBatch(10);
  assert.equal(second.succeeded, 1);
  assert.equal(await objectExists(media.key), false);
});

it('account deletion enqueues and removes the media bytes', async () => {
  const victim = await registerUser(api, `mdelete${Date.now() % 100000000}`, 'Media Delete');
  const media = await readyMedia(victim);
  const requestId = uuidv7();
  await db.query(
    `INSERT INTO data_deletion_requests (id, user_id, status, reason, execute_after)
     VALUES ($1, $2, 'scheduled', 'integration', now() - interval '1 minute')`,
    [requestId, victim.id],
  );
  const run = await privacy.runDueDeletions(5);
  assert.equal(run.completed, 1, JSON.stringify(run));
  const outbox = await db.query<{ status: string }>(`SELECT status FROM media_deletion_outbox WHERE object_key = $1`, [media.key]);
  assert.equal(outbox[0]?.status, 'pending');
  assert.equal(await objectExists(media.key), true);
  const result = await worker.processBatch(10);
  assert.equal(result.succeeded, 1);
  assert.equal(await objectExists(media.key), false);
  const asset = await db.query(`SELECT id FROM media_assets WHERE id = $1`, [media.id]);
  assert.equal(asset.length, 0);
});

it('deletes a stray object directly through the adapter', async () => {
  const key = `media/${A.id}/${uuidv7()}.jpg`;
  await s3.send(new DeleteObjectCommand({ Bucket: BUCKET, Key: key }));
  await storage.delete(key);
  assert.equal(await storage.head(key), null);
});
