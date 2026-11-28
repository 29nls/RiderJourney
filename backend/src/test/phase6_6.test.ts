import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PGliteDatabase } from './pglite.database.js';
import { runMigrations } from '../db/migrate.js';
import { buildTestApp } from './app.factory.js';
import { testStorage } from './fake-storage.js';
import { auth, registerUser, uploadImage, type TestApi } from './phase4.helpers.js';

/**
 * Phase 6.6A: media security state matrix, byte-serving side only.
 *
 * `accessible()` decides who may see metadata; `signGet()` and
 * `verifySignedAccess()` decide whether the object bytes leave the bucket.
 * These two decisions are separate, and the second one is what is pinned here.
 */

let db: PGliteDatabase;
let app: INestApplication;
let api: TestApi;
let A: { token: string; id: string };
let B: { token: string; id: string };
let counter = 0;

const SCAN = ['unscanned', 'scanning', 'clean', 'quarantined', 'scan_failed'] as const;
const MOD = ['not_required', 'pending_review', 'approved', 'rejected', 'hidden'] as const;

async function setStates(mediaId: string, scan: string, mod: string) {
  await db.query(`UPDATE media_assets SET scan_status = $2, moderation_status = $3 WHERE id = $1`, [mediaId, scan, mod]);
}

/** 'poster' is a moderated purpose, so the row starts in pending_review. */
async function readyMedia(purpose = 'poster') {
  counter += 1;
  return (await uploadImage(api, A.token, `p66_${purpose}_${Date.now()}_${counter}`, purpose)).id;
}

const getUrl = (token: string, id: string) => api.get(`/v1/media/${id}/url`).set(auth(token));

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.PLATE_ENCRYPTION_KEY = Buffer.alloc(32, 53).toString('base64');
  process.env.MEDIA_S3_BUCKET = 'test-bucket';
  process.env.MEDIA_S3_ACCESS_KEY = 'test-access';
  process.env.MEDIA_S3_SECRET_KEY = 'test-secret';
  // The viewer matrix uploads 125 assets of a few KB each; keep the default
  // allowance well above that so quota, not the rule under test, is the limit.
  process.env.MEDIA_QUOTA_BYTES_DEFAULT = '200000000';
  process.env.MEDIA_MAX_BYTES = '10000000';

  db = await PGliteDatabase.create();
  await runMigrations(db);
  const built = await buildTestApp(db);
  app = built.app;
  api = request(app.getHttpServer());

  A = await registerUser(api, 'p66_owner', 'Owner 6.6');
  B = await registerUser(api, 'p66_viewer', 'Viewer 6.6');
});

after(async () => {
  await db.close();
  testStorage.clear();
});

test('owner: unscanned and scanning withhold bytes, clean while reviewed mints', async () => {
  const id = await readyMedia();

  // Minted once from a served state, redeemed later below: only the current
  // row state gates, so this URL can still be read back into pending_review.
  await setStates(id, 'clean', 'approved');
  const minted = await getUrl(A.token, id);
  assert.match(minted.body.url as string, /^\/v1\/media\/.+access\?expires=/);
  // Served while the row says clean, whoever redeems it.
  assert.equal((await api.get(minted.body.url as string)).status, 200);

  // Enqueued media starts pending_review; there is no admin call that sets
  // scan_status back, so the earlier state is modelled directly.
  await setStates(id, 'unscanned', 'pending_review');
  const unscanned = await getUrl(A.token, id);
  assert.equal(unscanned.status, 200, JSON.stringify(unscanned.body));
  assert.equal(unscanned.body.url, null);
  assert.equal(unscanned.body.blockedReason, 'MEDIA_NOT_READY');
  assert.equal(unscanned.body.scanStatus, 'unscanned');
  assert.equal(unscanned.body.pendingReview, true, 'the owner still learns the row is awaiting review');

  await setStates(id, 'scanning', 'pending_review');
  const scanning = await getUrl(A.token, id);
  assert.equal(scanning.status, 200, JSON.stringify(scanning.body));
  assert.equal(scanning.body.url, null);
  assert.equal(scanning.body.blockedReason, 'MEDIA_NOT_READY');

  await setStates(id, 'clean', 'pending_review');
  const clean = await getUrl(A.token, id);
  assert.equal(clean.status, 200, JSON.stringify(clean.body));
  assert.equal(clean.body.pendingReview, true);
  // Clean passes the scan gate for its owner even in review; the review is
  // announced by the metadata, not hidden by a null URL.
  assert.notEqual(clean.body.url, null);
  assert.equal(clean.body.blockedReason, undefined);

  const held = await api.get(minted.body.url as string);
  assert.equal(held.status, 401, JSON.stringify(held.body));
  assert.equal(held.body.code, 'SIGNED_URL_REVOKED');
  assert.equal(held.body.downloadUrl, undefined);

  await setStates(id, 'clean', 'approved');
  const approved = await getUrl(A.token, id);
  assert.equal(approved.body.pendingReview, false);
  const served = await api.get(approved.body.url as string);
  assert.equal(served.status, 200, JSON.stringify(served.body));
  assert.ok(served.body.downloadUrl);
});

test('owner: quarantined and scan_failed are refused, never downgraded', async () => {
  const id = await readyMedia('avatar');

  for (const [scan, code] of [
    ['quarantined', 'MEDIA_QUARANTINED'],
    ['scan_failed', 'MEDIA_SCAN_FAILED'],
  ] as const) {
    await setStates(id, scan, 'not_required');
    const response = await getUrl(A.token, id);
    assert.equal(response.status, 409, `${scan}: ${JSON.stringify(response.body)}`);
    assert.equal(response.body.code, code);
    assert.equal(response.body.url, undefined, 'no URL may be minted for ' + scan);
  }
});

test('owner: rejected and hidden content keeps metadata but loses bytes', async () => {
  const id = await readyMedia('avatar');
  for (const mod of ['rejected', 'hidden'] as const) {
    await setStates(id, 'clean', mod);
    const response = await getUrl(A.token, id);
    assert.equal(response.status, 200, `${mod}: ${JSON.stringify(response.body)}`);
    assert.equal(response.body.id, id);
    assert.equal(response.body.scanStatus, 'clean');
    assert.equal(response.body.moderationStatus, mod);
    assert.equal(response.body.url, null, `${mod} must not hand out bytes`);
    assert.equal(response.body.pendingReview, false, `${mod} is not an open review`);
    assert.equal(response.body.blockedReason, 'MEDIA_NOT_READY');
  }
});

test('viewer: only clean and approved or not_required media yields bytes', async () => {
  for (const scan of SCAN) {
    for (const mod of MOD) {
      const id = await readyMedia();
      await setStates(id, scan, mod);

      const response = await getUrl(B.token, id);
      const allowed = scan === 'clean' && (mod === 'approved' || mod === 'not_required');
      const label = `${scan}/${mod} -> ${response.status} ${JSON.stringify(response.body)}`;

      if (!allowed) {
        assert.equal(response.status, 404, label);
        assert.equal(response.body.code, 'MEDIA_NOT_FOUND', label);
        continue;
      }
      assert.equal(response.status, 200, label);
      assert.match(response.body.url as string, /access\?expires=/, label);
      const served = await api.get(response.body.url as string);
      assert.equal(served.status, 200, label);
    }
  }
});

test('signed bytes are re-checked at redemption, not only when minted', async () => {
  const id = await readyMedia();
  // Redeemed anonymously, the link must be minted from a state an anonymous
  // viewer would also be granted: pending_review mints null here (see above).
  await setStates(id, 'clean', 'approved');

  const minted = await getUrl(A.token, id);
  assert.equal(minted.status, 200, JSON.stringify(minted.body));
  assert.equal((await api.get(minted.body.url as string)).status, 200, JSON.stringify(minted.body));

  // The same URL must stop working once the row leaves a safe state.
  await setStates(id, 'quarantined', 'approved');
  const revoked = await api.get(minted.body.url as string);
  assert.equal(revoked.status, 401, JSON.stringify(revoked.body));
  assert.equal(revoked.body.code, 'SIGNED_URL_REVOKED');
  assert.equal(revoked.body.downloadUrl, undefined);

  await setStates(id, 'clean', 'rejected');
  const hidden = await api.get(minted.body.url as string);
  assert.equal(hidden.status, 401, JSON.stringify(hidden.body));
  assert.equal(hidden.body.code, 'SIGNED_URL_REVOKED');
  assert.equal(hidden.body.downloadUrl, undefined);

  // Only current state gates, nothing is burned: returning to clean+approved
  // makes the same unexpired signature serve bytes again.
  await setStates(id, 'clean', 'approved');
  const restored = await api.get(minted.body.url as string);
  assert.equal(restored.status, 200, JSON.stringify(restored.body));
});
