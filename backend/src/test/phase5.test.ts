import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PGliteDatabase } from './pglite.database.js';
import { runMigrations } from '../db/migrate.js';
import { buildTestApp } from './app.factory.js';
import { totpCode } from '../admin/totp.js';
import type { PurchaseVerifier, VerifiedPurchase } from '../billing/billing.types.js';

class FakeVerifier implements PurchaseVerifier {
  readonly name = 'fake';
  state: VerifiedPurchase['state'] = 'active';
  async verify(input: { productId: string; basePlanId?: string }): Promise<VerifiedPurchase> {
    return {
      productId: input.productId,
      basePlanId: input.basePlanId ?? 'pro-base',
      state: this.state,
      expiresAt: new Date(Date.now() + 30 * 86_400_000).toISOString(),
      startedAt: new Date().toISOString(),
      autoRenew: true,
      acknowledged: true,
      linkedPurchaseToken: null,
      raw: { fake: true },
    };
  }
}

let db: PGliteDatabase;
let app: INestApplication;
let server: unknown;
const api = () => request(server as Parameters<typeof request>[0]);
let tokenA = '';
let tokenB = '';
let tokenC = '';
let supportToken = '';
let stepUp = '';
let supportStepUp = '';
let redeemCode = '';
let exportId = '';
let deletionId = '';

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.BILLING_ENABLED = 'true';
  process.env.PAID_FEATURES_ENABLED = 'true';
  process.env.BILLING_NOTIFICATION_SECRET = 'notification-secret';
  process.env.REDEEM_CODE_PEPPER = 'redeem-test-pepper';
  db = await PGliteDatabase.create();
  await runMigrations(db);
  await db.query(`UPDATE plans SET billing_enabled = true WHERE code = 'pro'`);
  await db.query(`UPDATE plans SET play_product_id = 'pro_monthly' WHERE code = 'pro'`);
  await db.query(
    `INSERT INTO billing_products (product_id, base_plan_id, plan_code, active) VALUES ('pro_monthly', 'pro-base', 'pro', true)`,
  );
  await db.query(`UPDATE admin_config SET value = '{"billingEnabled": true, "paidFeaturesEnabled": true}'::jsonb WHERE key = 'features'`);

  const built = await buildTestApp(db, undefined, undefined, { verifier: new FakeVerifier() });
  app = built.app;
  server = app.getHttpServer();

  const register = async (email: string, username: string) => {
    const response = await api().post('/v1/auth/register').send({
      email, username, displayName: username, password: 'correct-horse-battery',
    });
    assert.equal(response.status, 201, JSON.stringify(response.body));
    return response.body.accessToken as string;
  };
  tokenA = await register('admin@example.com', 'admin_rider');
  tokenB = await register('b@example.com', 'rider_b');
  tokenC = await register('c@example.com', 'rider_c');
  supportToken = await register('support@example.com', 'support_rider');

  await db.query(
    `INSERT INTO admin_users (user_id, role) SELECT id, 'superadmin' FROM users WHERE email = 'admin@example.com'`,
  );
  await db.query(
    `INSERT INTO admin_users (user_id, role) SELECT id, 'support' FROM users WHERE email = 'support@example.com'`,
  );

  const enrolled = await api().post('/v1/admin/mfa/enroll').set('Authorization', `Bearer ${tokenA}`).expect(200);
  await api().post('/v1/admin/mfa/confirm')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ code: totpCode(enrolled.body.secret) })
    .expect(200);
  const stepped = await api().post('/v1/admin/mfa/step-up')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ code: totpCode(enrolled.body.secret) })
    .expect(200);
  stepUp = stepped.body.stepUpToken;

  const supportEnrolled = await api().post('/v1/admin/mfa/enroll').set('Authorization', `Bearer ${supportToken}`).expect(200);
  await api().post('/v1/admin/mfa/confirm')
    .set('Authorization', `Bearer ${supportToken}`)
    .send({ code: totpCode(supportEnrolled.body.secret) })
    .expect(200);
  const supportStepped = await api().post('/v1/admin/mfa/step-up')
    .set('Authorization', `Bearer ${supportToken}`)
    .send({ code: totpCode(supportEnrolled.body.secret) })
    .expect(200);
  supportStepUp = supportStepped.body.stepUpToken;
});

after(async () => {
  await app.close();
  await db.close();
});

test('billing verification grants server-side plan and rejects token replay', async () => {
  const before = await api().get('/v1/subscription').set('Authorization', `Bearer ${tokenA}`).expect(200);
  assert.equal(before.body.planCode, 'free');
  assert.equal(before.body.entitlements.convoyCapacity, 3);

  const verified = await api().post('/v1/billing/verify')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ purchaseToken: 'purchase-token-aaaaaaaaaaaaaaaa', productId: 'pro_monthly', basePlanId: 'pro-base', planCode: 'pro' })
    .expect(200);
  assert.equal(verified.body.subscription.planCode, 'pro');
  assert.equal(verified.body.duplicate, false);
  assert.equal(verified.body.entitlements.convoyCapacity, 20);

  const duplicate = await api().post('/v1/billing/verify')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ purchaseToken: 'purchase-token-aaaaaaaaaaaaaaaa', productId: 'pro_monthly', basePlanId: 'pro-base', planCode: 'pro' })
    .expect(200);
  assert.equal(duplicate.body.duplicate, true);

  const stolen = await api().post('/v1/billing/verify')
    .set('Authorization', `Bearer ${tokenB}`)
    .send({ purchaseToken: 'purchase-token-aaaaaaaaaaaaaaaa', productId: 'pro_monthly', basePlanId: 'pro-base', planCode: 'pro' })
    .expect(409);
  assert.equal(stolen.body.code, 'PURCHASE_ALREADY_BOUND');
});

test('billing notifications are authenticated and idempotent', async () => {
  const payload = Buffer.from(JSON.stringify({
    subscriptionNotification: { purchaseToken: 'purchase-token-aaaaaaaaaaaaaaaa', subscriptionId: 'pro_monthly', notificationType: 2 },
  })).toString('base64');
  const first = await api().post('/v1/billing/notifications')
    .set('x-billing-secret', 'notification-secret')
    .send({ message: { messageId: 'msg-1', data: payload } })
    .expect(200);
  assert.equal(first.body.processed, true);
  const second = await api().post('/v1/billing/notifications')
    .set('x-billing-secret', 'notification-secret')
    .send({ message: { messageId: 'msg-1', data: payload } })
    .expect(200);
  assert.equal(second.body.duplicate, true);
  await api().post('/v1/billing/notifications')
    .set('x-billing-secret', 'wrong')
    .send({ message: { messageId: 'msg-2', data: payload } })
    .expect(401);
});

test('free plan vehicle limit is enforced from server-side configuration', async () => {
  for (let index = 0; index < 3; index += 1) {
    await api().post('/v1/vehicles')
      .set('Authorization', `Bearer ${tokenC}`)
      .send({ type: 'motorcycle', brand: 'Honda', model: `V${index}` })
      .expect(201);
  }
  const fourth = await api().post('/v1/vehicles')
    .set('Authorization', `Bearer ${tokenC}`)
    .send({ type: 'motorcycle', brand: 'Honda', model: 'V4' })
    .expect(409);
  assert.equal(fourth.body.code, 'VEHICLE_LIMIT_REACHED');
});

test('admin RBAC, step-up, redeem idempotency, and audit trail', async () => {
  await api().get('/v1/admin/dashboard').set('Authorization', `Bearer ${tokenB}`).expect(403);
  const noStepUp = await api().post('/v1/admin/redeem')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ rewardKind: 'points', rewardValue: { points: 100 }, quotaTotal: 1, reason: 'Kampanye uji terkontrol' })
    .expect(403);
  assert.equal(noStepUp.body.code, 'STEP_UP_REQUIRED');
  await api().get('/v1/admin/dashboard').set('Authorization', `Bearer ${supportToken}`).expect(200);
  await api().patch('/v1/admin/users/' + String((await db.query<{ id: string }>(`SELECT id FROM users WHERE email = 'b@example.com'`))[0].id) + '/status')
    .set('Authorization', `Bearer ${supportToken}`)
    .set('x-step-up-token', supportStepUp)
    .send({ status: 'suspended', reason: 'Support tidak boleh menindak' })
    .expect(403);

  const created = await api().post('/v1/admin/redeem')
    .set('Authorization', `Bearer ${tokenA}`)
    .set('x-step-up-token', stepUp)
    .send({ rewardKind: 'points', rewardValue: { points: 100 }, quotaTotal: 1, reason: 'Kampanye uji terkontrol' })
    .expect(201);
  redeemCode = created.body.code;
  assert.ok(redeemCode);

  const redeemed = await api().post('/v1/redeem')
    .set('Authorization', `Bearer ${tokenB}`)
    .send({ code: redeemCode, idempotencyKey: 'redeem-idem-0001' })
    .expect(200);
  assert.equal(redeemed.body.duplicate, false);
  const retry = await api().post('/v1/redeem')
    .set('Authorization', `Bearer ${tokenB}`)
    .send({ code: redeemCode, idempotencyKey: 'redeem-idem-0001' })
    .expect(200);
  assert.equal(retry.body.duplicate, true);
  const exhausted = await api().post('/v1/redeem')
    .set('Authorization', `Bearer ${tokenC}`)
    .send({ code: redeemCode, idempotencyKey: 'redeem-idem-0002' })
    .expect(409);
  assert.equal(exhausted.body.code, 'REDEEM_QUOTA_EXHAUSTED');

  const ledger = await db.query<{ delta: number }>(
    `SELECT delta FROM point_ledger WHERE reason = 'redeem_bonus' AND reference_type = 'redeem'`,
  );
  assert.deepEqual(ledger.map((row) => Number(row.delta)), [100]);
  const audit = await db.query<{ action: string; reason: string }>(
    `SELECT action, reason FROM admin_audit_logs WHERE action = 'redeem.create'`,
  );
  assert.equal(audit.length, 1);
  assert.equal(audit[0].reason, 'Kampanye uji terkontrol');
});

test('privacy export and scheduled deletion scrub the account', async () => {
  const requested = await api().post('/v1/privacy/export').set('Authorization', `Bearer ${tokenC}`).expect(201);
  exportId = requested.body.id;
  await api().post('/v1/admin/jobs/retention')
    .set('Authorization', `Bearer ${tokenA}`)
    .set('x-step-up-token', stepUp)
    .expect(200);
  const payload = await api().get(`/v1/privacy/export/${exportId}`).set('Authorization', `Bearer ${tokenC}`).expect(200);
  assert.equal(payload.body.profile[0].email, 'c@example.com');

  const deletion = await api().post('/v1/privacy/deletion')
    .set('Authorization', `Bearer ${tokenC}`)
    .send({ confirmation: 'HAPUS AKUN' })
    .expect(201);
  deletionId = deletion.body.id;
  await db.query(`UPDATE data_deletion_requests SET execute_after = now() - interval '1 minute' WHERE id = $1`, [deletionId]);
  await api().post('/v1/admin/jobs/retention')
    .set('Authorization', `Bearer ${tokenA}`)
    .set('x-step-up-token', stepUp)
    .expect(200);
  const scrubbed = await db.query<{ email: string; status: string }>(`SELECT email, status FROM users WHERE email LIKE 'deleted+%'`);
  assert.equal(scrubbed[0].status, 'deleted');
  await api().get('/v1/auth/session').set('Authorization', `Bearer ${tokenC}`).expect(403);
});

test('admin config kill switch disables billing and premium entitlement', async () => {
  await api().put('/v1/admin/config')
    .set('Authorization', `Bearer ${tokenA}`)
    .set('x-step-up-token', stepUp)
    .send({ key: 'features', value: { billingEnabled: false, paidFeaturesEnabled: false }, reason: 'Menonaktifkan uji fitur berbayar' })
    .expect(200);
  const blocked = await api().post('/v1/billing/verify')
    .set('Authorization', `Bearer ${tokenA}`)
    .send({ purchaseToken: 'purchase-token-bbbbbbbbbbbbbbbb', productId: 'pro_monthly', basePlanId: 'pro-base', planCode: 'pro' })
    .expect(409);
  assert.equal(blocked.body.code, 'BILLING_DISABLED');
  const downgraded = await api().get('/v1/subscription').set('Authorization', `Bearer ${tokenA}`).expect(200);
  assert.equal(downgraded.body.planCode, 'free');
  assert.equal(downgraded.body.entitlements.convoyCapacity, 3);
});
