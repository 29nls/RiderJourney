import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PGliteDatabase } from './pglite.database.js';
import { runMigrations } from '../db/migrate.js';
import { buildTestApp } from './app.factory.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { MediaDeletionWorker } from '../media/deletion-outbox.js';
import { AlertService } from '../media/alerting.js';
import { StorageQuotaService } from '../media/storage-quota.js';
import { testStorage } from './fake-storage.js';
import { auth, registerUser, uploadImage, type TestApi } from './phase4.helpers.js';
import { totpCode } from '../admin/totp.js';

/**
 * Phase 6.4: deletion recovery, cancellation races, dead-letter operations,
 * moderation as a separate axis from malware scanning, and alert dedup.
 */

let db: PGliteDatabase;
let app: INestApplication;
let api: TestApi;
let config: AppConfig;
let worker: MediaDeletionWorker;
let quota: StorageQuotaService;
let alerts: AlertService;
let A: { token: string; id: string };
let B: { token: string; id: string };
let adminToken = '';
let supportToken = '';
let stepUp = '';
let supportStepUp = '';

const keyFrom = (uploadUrl: string) => new URL(uploadUrl).pathname.replace(/^\//, '');

async function statusOf(mediaId: string): Promise<string> {
  const rows = await db.query<{ status: string }>(`SELECT status FROM media_assets WHERE id = $1`, [mediaId]);
  return rows[0].status;
}

async function moderationOf(mediaId: string): Promise<string> {
  const rows = await db.query<{ moderation_status: string }>(
    `SELECT moderation_status FROM media_assets WHERE id = $1`,
    [mediaId],
  );
  return rows[0].moderation_status;
}

async function makeClean(mediaId: string): Promise<void> {
  await db.query(`UPDATE media_assets SET scan_status = 'clean' WHERE id = $1`, [mediaId]);
}

/** Simulates a worker that claimed the job and then died. */
async function abandonJob(key: string, attempts = 1): Promise<string> {
  const rows = await db.query<{ id: string }>(
    `UPDATE media_deletion_outbox
     SET status = 'failed', attempts = $2, last_error = 'worker died'
     WHERE object_key = $1 RETURNING id`,
    [key, attempts],
  );
  return rows[0].id;
}

async function ageDeletion(mediaId: string): Promise<void> {
  await db.query(
    `UPDATE media_assets SET deletion_requested_at = now() - interval '2 hours' WHERE id = $1`,
    [mediaId],
  );
}

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.PLATE_ENCRYPTION_KEY = Buffer.alloc(32, 41).toString('base64');
  process.env.MEDIA_S3_BUCKET = 'test-bucket';
  process.env.MEDIA_S3_ACCESS_KEY = 'test-access';
  process.env.MEDIA_S3_SECRET_KEY = 'test-secret';
  process.env.MEDIA_QUOTA_BYTES_DEFAULT = '25000000';
  process.env.MEDIA_MAX_BYTES = '10000000';
  process.env.MEDIA_DELETION_MAX_ATTEMPTS = '3';
  process.env.MEDIA_DELETION_STALE_SECONDS = '900';

  db = await PGliteDatabase.create();
  await runMigrations(db);
  const built = await buildTestApp(db);
  app = built.app;
  config = app.get<AppConfig>(APP_CONFIG);
  worker = app.get(MediaDeletionWorker);
  quota = app.get(StorageQuotaService);
  alerts = app.get(AlertService);
  api = request(app.getHttpServer() as Parameters<typeof request>[0]);
  A = await registerUser(api, 'phase64_owner', 'Owner 6.4');
  B = await registerUser(api, 'phase64_other', 'Other 6.4');
  testStorage.clear();

  const admin = await registerUser(api, 'phase64_admin', 'Admin 6.4');
  const support = await registerUser(api, 'phase64_support', 'Support 6.4');
  await db.query(`INSERT INTO admin_users (user_id, role) VALUES ($1, 'superadmin')`, [admin.id]);
  await db.query(`INSERT INTO admin_users (user_id, role) VALUES ($1, 'support')`, [support.id]);
  adminToken = admin.token;
  supportToken = support.token;

  for (const [token, setter] of [[adminToken, (v: string) => (stepUp = v)], [supportToken, (v: string) => (supportStepUp = v)]] as const) {
    const enrolled = await api.post('/v1/admin/mfa/enroll').set(auth(token)).expect(200);
    await api.post('/v1/admin/mfa/confirm').set(auth(token)).send({ code: totpCode(enrolled.body.secret) }).expect(200);
    const stepped = await api.post('/v1/admin/mfa/step-up').set(auth(token)).send({ code: totpCode(enrolled.body.secret) }).expect(200);
    setter(stepped.body.stepUpToken as string);
  }
});

after(async () => {
  await app.close();
  await db.close();
});

// ---------------------------------------------------------------------------
// Deletion recovery
// ---------------------------------------------------------------------------

test('a stuck deleting row whose object still exists is requeued, never returned to ready', async () => {
  const ready = await uploadImage(api, A.token, `p64_stale_req_${Date.now()}`);
  const key = keyFrom(ready.uploadUrl);
  const before = await quota.getQuota(A.id);

  await api.delete(`/v1/media/${ready.id}`).set(auth(A.token)).expect(200);
  await abandonJob(key);
  await ageDeletion(ready.id);

  const result = await worker.reconcileStale();
  assert.ok(result.scanned >= 1);
  assert.ok(result.requeued >= 1);
  assert.equal(await statusOf(ready.id), 'deleting', 'recovery must not resurrect deleted content');

  const job = await db.query<{ status: string }>(
    `SELECT status FROM media_deletion_outbox WHERE object_key = $1`,
    [key],
  );
  assert.equal(job[0].status, 'pending');

  const during = await quota.getQuota(A.id);
  assert.equal(during.usedBytes, before.usedBytes, 'quota stays held while the object exists');

  const ops = await db.query<{ action: string }>(
    `SELECT l.action FROM media_deletion_ops_log l
     JOIN media_deletion_outbox o ON o.id = l.outbox_id
     WHERE o.object_key = $1`,
    [key],
  );
  assert.ok(ops.some((row) => row.action === 'reconcile'));

  await worker.processBatch(10);
  assert.equal(testStorage.objects.has(key), false);
  assert.equal(await statusOf(ready.id), 'deleted');
});

test('a stuck deleting row whose object is already gone becomes deleted and frees quota', async () => {
  const ready = await uploadImage(api, A.token, `p64_stale_gone_${Date.now()}`);
  const key = keyFrom(ready.uploadUrl);
  const before = await quota.getQuota(A.id);
  const size = await db.query<{ size_bytes: number }>(`SELECT size_bytes FROM media_assets WHERE id = $1`, [ready.id]);
  const bytes = Number(size[0].size_bytes);

  await api.delete(`/v1/media/${ready.id}`).set(auth(A.token)).expect(200);
  await abandonJob(key);
  await ageDeletion(ready.id);
  testStorage.objects.delete(key);

  const result = await worker.reconcileStale();
  assert.ok(result.completed >= 1);
  assert.equal(await statusOf(ready.id), 'deleted');

  const afterQuota = await quota.getQuota(A.id);
  assert.equal(afterQuota.usedBytes, before.usedBytes - bytes);
});

// ---------------------------------------------------------------------------
// Cancellation
// ---------------------------------------------------------------------------

test('cancellation before the worker claims the job returns media to ready', async () => {
  const ready = await uploadImage(api, A.token, `p64_cancel_${Date.now()}`);
  const key = keyFrom(ready.uploadUrl);

  await api.delete(`/v1/media/${ready.id}`).set(auth(A.token)).expect(200);
  const cancelled = await api.post(`/v1/media/${ready.id}/cancel-deletion`).set(auth(A.token));
  assert.equal(cancelled.status, 200, JSON.stringify(cancelled.body));
  assert.equal(cancelled.body.cancelled, true);
  assert.equal(await statusOf(ready.id), 'ready');

  const jobs = await db.query(`SELECT id FROM media_deletion_outbox WHERE object_key = $1`, [key]);
  assert.equal(jobs.length, 0, 'the pending job is withdrawn, not left to run later');
  assert.equal(testStorage.objects.has(key), true);

  const ops = await db.query<{ action: string }>(
    `SELECT action FROM media_deletion_ops_log WHERE actor_id = $1 AND action = 'cancel'`,
    [A.id],
  );
  assert.equal(ops.length, 1);
});

test('cancellation is refused once a worker has claimed the job', async () => {
  const ready = await uploadImage(api, A.token, `p64_cancel_claimed_${Date.now()}`);
  const key = keyFrom(ready.uploadUrl);
  await api.delete(`/v1/media/${ready.id}`).set(auth(A.token)).expect(200);
  await abandonJob(key, 2);

  const refused = await api.post(`/v1/media/${ready.id}/cancel-deletion`).set(auth(A.token));
  assert.equal(refused.status, 409, JSON.stringify(refused.body));
  assert.equal(refused.body.code, 'MEDIA_DELETION_ALREADY_CLAIMED');
  assert.equal(await statusOf(ready.id), 'deleting');
});

test('cancellation cannot be used to recover an already deleted or foreign media', async () => {
  const ready = await uploadImage(api, A.token, `p64_cancel_done_${Date.now()}`);
  const key = keyFrom(ready.uploadUrl);
  await api.delete(`/v1/media/${ready.id}`).set(auth(A.token)).expect(200);

  const foreign = await api.post(`/v1/media/${ready.id}/cancel-deletion`).set(auth(B.token));
  assert.equal(foreign.status, 404);

  await worker.processBatch(10);
  assert.equal(testStorage.objects.has(key), false);
  const done = await api.post(`/v1/media/${ready.id}/cancel-deletion`).set(auth(A.token));
  assert.equal(done.status, 409);
  assert.equal(done.body.code, 'MEDIA_DELETION_COMPLETED');
});

// ---------------------------------------------------------------------------
// Dead-letter operations
// ---------------------------------------------------------------------------

test('dead-letter listing and retry are admin-only and keep the failure history', async () => {
  const ready = await uploadImage(api, A.token, `p64_dead_${Date.now()}`);
  const key = keyFrom(ready.uploadUrl);
  await api.delete(`/v1/media/${ready.id}`).set(auth(A.token)).expect(200);
  const jobId = await abandonJob(key, 3);

  const denied = await api.get('/v1/admin/media/deletions/failed').set(auth(A.token));
  assert.ok([401, 403].includes(denied.status));

  const listed = await api.get('/v1/admin/media/deletions/failed').set(auth(adminToken));
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  const item = (listed.body.items as Array<Record<string, unknown>>).find((row) => row.id === jobId);
  assert.ok(item, 'failed job is visible to operators');
  assert.equal(item!.lastError, 'worker died');
  assert.equal(item!.objectKey, undefined, 'object keys are not exposed');

  const support = await api
    .post(`/v1/admin/media/deletions/${jobId}/retry`)
    .set(auth(supportToken))
    .set('x-step-up-token', supportStepUp)
    .send({ note: 'try again' });
  assert.equal(support.status, 403, 'support cannot operate the deletion queue');

  const retried = await api
    .post(`/v1/admin/media/deletions/${jobId}/retry`)
    .set(auth(adminToken))
    .set('x-step-up-token', stepUp)
    .send({ note: 'storage is back' });
  assert.equal(retried.status, 200, JSON.stringify(retried.body));
  assert.equal(retried.body.status, 'pending');

  const row = await db.query<{ status: string; attempts: number }>(
    `SELECT status, attempts FROM media_deletion_outbox WHERE id = $1`,
    [jobId],
  );
  assert.equal(row[0].status, 'pending');
  assert.equal(row[0].attempts, 0);

  const audit = await db.query<{ action: string }>(
    `SELECT action FROM admin_audit_logs WHERE target_id = $1`,
    [jobId],
  );
  assert.ok(audit.some((entry) => entry.action === 'media.deletion.retry'));

  const again = await api
    .post(`/v1/admin/media/deletions/${jobId}/retry`)
    .set(auth(adminToken))
    .set('x-step-up-token', stepUp)
    .send({ note: 'duplicate' });
  assert.equal(again.status, 409);
});

// ---------------------------------------------------------------------------
// Moderation
// ---------------------------------------------------------------------------

test('content moderation is separate from scanning and gates public access', async () => {
  // 'poster' is shared content with no parent post, so visibility depends only
  // on the two policies this test is about.
  const media = await uploadImage(api, A.token, `p64_moderation_${Date.now()}`, 'poster');
  assert.equal(await moderationOf(media.id), 'pending_review', 'community content enters the queue');

  const ownerRead = await api.get(`/v1/media/${media.id}/url`).set(auth(A.token));
  assert.equal(ownerRead.status, 200);

  const unreviewed = await api.get(`/v1/media/${media.id}/url`).set(auth(B.token));
  assert.equal(unreviewed.status, 404);

  await makeClean(media.id);
  const cleanButUnreviewed = await api.get(`/v1/media/${media.id}/url`).set(auth(B.token));
  assert.equal(cleanButUnreviewed.status, 404, 'a clean file still needs a moderation decision');

  const queue = await api.get('/v1/admin/media/moderation').set(auth(adminToken));
  assert.equal(queue.status, 200, JSON.stringify(queue.body));
  const listed = (queue.body.items as Array<Record<string, unknown>>).find((row) => row.id === media.id);
  assert.ok(listed, 'pending media appears in the review queue');
  assert.equal(listed!.scanStatus, 'clean');
  assert.ok((queue.body.summary as Record<string, number>).pendingReview >= 1);

  const support = await api
    .post(`/v1/admin/media/moderation/${media.id}/decision`)
    .set(auth(supportToken))
    .set('x-step-up-token', supportStepUp)
    .send({ action: 'approve' });
  assert.equal(support.status, 403);

  const missingReason = await api
    .post(`/v1/admin/media/moderation/${media.id}/decision`)
    .set(auth(adminToken))
    .set('x-step-up-token', stepUp)
    .send({ action: 'reject' });
  assert.equal(missingReason.status, 400, 'rejection requires a reason');

  const approved = await api
    .post(`/v1/admin/media/moderation/${media.id}/decision`)
    .set(auth(adminToken))
    .set('x-step-up-token', stepUp)
    .send({ action: 'approve' });
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.moderationStatus, 'approved');

  const scanRow = await db.query<{ scan_status: string }>(
    `SELECT scan_status FROM media_assets WHERE id = $1`,
    [media.id],
  );
  assert.equal(scanRow[0].scan_status, 'clean', 'a review decision never rewrites malware state');

  const visible = await api.get(`/v1/media/${media.id}/url`).set(auth(B.token));
  assert.equal(visible.status, 200, JSON.stringify(visible.body));

  const history = await api.get(`/v1/admin/media/moderation/${media.id}/history`).set(auth(adminToken));
  const actions = (history.body.items as Array<Record<string, unknown>>).map((row) => row.action);
  assert.ok(actions.includes('request'));
  assert.ok(actions.includes('approve'));

  const rejected = await api
    .post(`/v1/admin/media/moderation/${media.id}/decision`)
    .set(auth(adminToken))
    .set('x-step-up-token', stepUp)
    .send({ action: 'reject', reason: 'Komposisi melanggar pedoman komunitas' });
  assert.equal(rejected.status, 200);
  const blocked = await api.get(`/v1/media/${media.id}/url`).set(auth(B.token));
  assert.equal(blocked.status, 404, 'rejected content is hidden from other users');

  const reopened = await api
    .post(`/v1/admin/media/moderation/${media.id}/reopen`)
    .set(auth(adminToken))
    .set('x-step-up-token', stepUp)
    .send({ reason: 'Banding diterima untuk ditinjau ulang' });
  assert.equal(reopened.status, 200);
  assert.equal(await moderationOf(media.id), 'pending_review');
});

test('personal assets are not queued but still require a clean scan', async () => {
  const avatar = await uploadImage(api, A.token, `p64_avatar_${Date.now()}`, 'avatar');
  assert.equal(await moderationOf(avatar.id), 'not_required');

  const unscanned = await api.get(`/v1/media/${avatar.id}/url`).set(auth(B.token));
  assert.equal(unscanned.status, 404);

  await makeClean(avatar.id);
  const clean = await api.get(`/v1/media/${avatar.id}/url`).set(auth(B.token));
  assert.equal(clean.status, 200, JSON.stringify(clean.body));
});

// ---------------------------------------------------------------------------
// Alerting
// ---------------------------------------------------------------------------

test('alerts deduplicate, expose no delivery provider, and resolve on recovery', async () => {
  const denied = await api.get('/v1/admin/media/alerts').set(auth(A.token));
  assert.ok([401, 403].includes(denied.status));

  const first = await alerts.evaluate();
  assert.equal(first.notifier.available, false, 'no notification provider is configured');

  const openRows = await db.query<{ kind: string; occurrences: number; status: string }>(
    `SELECT kind, occurrences, status FROM ops_alert_events WHERE kind = 'deletion_worker_unavailable'`,
  );
  const occurrencesAfterFirst = openRows[0]?.occurrences ?? 0;
  assert.ok(occurrencesAfterFirst >= 1);

  await alerts.evaluate();
  const again = await db.query<{ occurrences: number }>(
    `SELECT occurrences FROM ops_alert_events WHERE kind = 'deletion_worker_unavailable'`,
  );
  assert.ok(again[0].occurrences > occurrencesAfterFirst, 'repeat conditions bump the same row');

  const ready = await uploadImage(api, A.token, `p64_alert_dead_${Date.now()}`);
  const key = keyFrom(ready.uploadUrl);
  await api.delete(`/v1/media/${ready.id}`).set(auth(A.token)).expect(200);
  await abandonJob(key, 3);

  await alerts.evaluate();
  const dead = await db.query<{ status: string; severity: string }>(
    `SELECT status, severity FROM ops_alert_events WHERE kind = 'deletion_dead_letter'`,
  );
  assert.equal(dead[0].status, 'active');
  assert.equal(dead[0].severity, 'critical');

  const listed = await api.get('/v1/admin/media/alerts').set(auth(adminToken));
  assert.equal(listed.status, 200, JSON.stringify(listed.body));
  assert.equal(listed.body.notifier.available, false);
  const kinds = (listed.body.items as Array<Record<string, unknown>>).map((row) => row.kind);
  assert.ok(kinds.includes('deletion_dead_letter'));

  // Earlier tests intentionally leave dead letters behind, so clear them all:
  // the condition is aggregate, and the assertion is about recovery.
  await db.query(`UPDATE media_deletion_outbox SET status = 'done' WHERE status = 'failed'`);
  void key;
  await alerts.evaluate();
  const resolved = await db.query<{ status: string; resolved_at: Date | null }>(
    `SELECT status, resolved_at FROM ops_alert_events WHERE kind = 'deletion_dead_letter'`,
  );
  assert.equal(resolved[0].status, 'resolved');
  assert.ok(resolved[0].resolved_at, 'recovery timestamp is recorded');

  const evaluateDenied = await api.post('/v1/admin/media/alerts/evaluate').set(auth(supportToken));
  assert.equal(evaluateDenied.status, 403, 'alert evaluation is an operations permission');
});
