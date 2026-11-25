import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PGliteDatabase } from './pglite.database.js';
import { runMigrations } from '../db/migrate.js';
import { buildTestApp } from './app.factory.js';
import { auth, registerUser, uploadImage, type TestApi } from './phase4.helpers.js';

let db: PGliteDatabase;
let app: INestApplication;
let api: TestApi;
let owner: { token: string; id: string };
let member: { token: string; id: string };
let outsider: { token: string; id: string };
let pending: { token: string; id: string };
let communityId = '';

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.PLATE_ENCRYPTION_KEY = Buffer.alloc(32, 13).toString('base64');
  process.env.MEDIA_S3_BUCKET = 'riderjourney-test';
  process.env.MEDIA_S3_ACCESS_KEY = 'test-access';
  process.env.MEDIA_S3_SECRET_KEY = 'test-secret';
  process.env.MEDIA_S3_ENDPOINT = 'https://storage.example.test';
  db = await PGliteDatabase.create();
  await runMigrations(db);
  const built = await buildTestApp(db);
  app = built.app;
  api = request(app.getHttpServer() as Parameters<typeof request>[0]) as unknown as TestApi;

  owner = await registerUser(api, 'community_owner', 'Community Owner');
  member = await registerUser(api, 'community_member', 'Community Member');
  outsider = await registerUser(api, 'community_outsider', 'Community Outsider');
  pending = await registerUser(api, 'community_pending', 'Community Pending');
});

after(async () => {
  await app.close();
  await db.close();
});

test('create community seeds owner, policy, and usable member permissions', async () => {
  const created = await api.post('/v1/communities').set(auth(owner.token)).send({
    slug: 'Malam-Rider',
    name: 'Rider Malam',
    description: 'Komunitas touring malam.',
    region: 'Bandung',
    visibility: 'private',
  });
  assert.equal(created.status, 201, JSON.stringify(created.body));
  communityId = created.body.id;
  assert.equal(created.body.slug, 'malam-rider');
  assert.equal(created.body.visibility, 'private');
  assert.equal(created.body.memberCount, 1);
  assert.deepEqual(created.body.viewerMembership, {
    status: 'active',
    role: 'owner',
    joinedAt: created.body.viewerMembership.joinedAt,
  });

  const publicView = await api.get(`/v1/communities/${communityId}`).set(auth(outsider.token));
  assert.equal(publicView.status, 200, JSON.stringify(publicView.body));
  assert.equal(publicView.body.viewerMembership, null);

  const duplicate = await api.post('/v1/communities').set(auth(member.token)).send({
    slug: 'malam-rider',
    name: 'Nama Lain',
  });
  assert.equal(duplicate.status, 409);
  assert.equal(duplicate.body.code, 'COMMUNITY_SLUG_TAKEN');
});

test('private community join becomes a request and approval activates membership', async () => {
  const joined = await api.post(`/v1/communities/${communityId}/join`).set(auth(member.token));
  assert.equal(joined.status, 200, JSON.stringify(joined.body));
  assert.equal(joined.body.status, 'requested');
  assert.equal(joined.body.duplicate, false);
  assert.equal(joined.body.joinedAt, null);

  const retry = await api.post(`/v1/communities/${communityId}/join`).set(auth(member.token));
  assert.equal(retry.status, 200);
  assert.equal(retry.body.status, 'requested');
  assert.equal(retry.body.duplicate, true);

  const requests = await api.get(`/v1/communities/${communityId}/join-requests`).set(auth(owner.token));
  assert.equal(requests.status, 200, JSON.stringify(requests.body));
  assert.ok(requests.body.items.some((item: { userId: string }) => item.userId === member.id));

  const forbiddenList = await api.get(`/v1/communities/${communityId}/join-requests`).set(auth(outsider.token));
  assert.equal(forbiddenList.status, 403);
  const forbiddenApprove = await api
    .post(`/v1/communities/${communityId}/join-requests/${member.id}/approve`)
    .set(auth(outsider.token));
  assert.equal(forbiddenApprove.status, 403);

  const approved = await api
    .post(`/v1/communities/${communityId}/join-requests/${member.id}/approve`)
    .set(auth(owner.token));
  assert.equal(approved.status, 200, JSON.stringify(approved.body));
  assert.equal(approved.body.status, 'active');
  assert.equal(approved.body.approved, true);

  const activeRetry = await api.post(`/v1/communities/${communityId}/join`).set(auth(member.token));
  assert.equal(activeRetry.body.status, 'active');
  assert.equal(activeRetry.body.duplicate, true);

  const members = await api.get(`/v1/communities/${communityId}/members`).set(auth(member.token));
  assert.equal(members.status, 200, JSON.stringify(members.body));
  assert.ok(members.body.items.some((item: { id: string; role: string }) => item.id === owner.id && item.role === 'owner'));
  assert.ok(members.body.items.some((item: { id: string; role: string }) => item.id === member.id && item.role === 'member'));
  assert.equal((await api.get(`/v1/communities/${communityId}/members`).set(auth(outsider.token))).status, 404);
});

test('role changes are permission-checked and affect who can approve requests', async () => {
  const memberCannotPromote = await api
    .patch(`/v1/communities/${communityId}/members/${pending.id}/role`)
    .set(auth(member.token))
    .send({ role: 'moderator' });
  assert.equal(memberCannotPromote.status, 403);

  const promoted = await api
    .patch(`/v1/communities/${communityId}/members/${member.id}/role`)
    .set(auth(owner.token))
    .send({ role: 'moderator' });
  assert.equal(promoted.status, 200, JSON.stringify(promoted.body));
  assert.equal(promoted.body.role, 'moderator');
  assert.equal(promoted.body.duplicate, false);

  const ownerRoleChange = await api
    .patch(`/v1/communities/${communityId}/members/${owner.id}/role`)
    .set(auth(owner.token))
    .send({ role: 'admin' });
  assert.equal(ownerRoleChange.status, 403);
  assert.equal(ownerRoleChange.body.code, 'OWNER_ROLE_IMMUTABLE');

  const missingMember = await api
    .patch(`/v1/communities/${communityId}/members/${pending.id}/role`)
    .set(auth(owner.token))
    .send({ role: 'member' });
  assert.equal(missingMember.status, 404);

  const requested = await api.post(`/v1/communities/${communityId}/join`).set(auth(pending.token));
  assert.equal(requested.body.status, 'requested');
  const moderatorApproves = await api
    .post(`/v1/communities/${communityId}/join-requests/${pending.id}/approve`)
    .set(auth(member.token));
  assert.equal(moderatorApproves.status, 200, JSON.stringify(moderatorApproves.body));
  assert.equal(moderatorApproves.body.status, 'active');

  const sameRole = await api
    .patch(`/v1/communities/${communityId}/members/${pending.id}/role`)
    .set(auth(owner.token))
    .send({ role: 'member' });
  assert.equal(sameRole.status, 200);
  assert.equal(sameRole.body.duplicate, true);

  const memberCannotChangeModerator = await api
    .patch(`/v1/communities/${communityId}/members/${member.id}/role`)
    .set(auth(pending.token))
    .send({ role: 'member' });
  assert.equal(memberCannotChangeModerator.status, 403);

  const audit = await db.query<{ action: string }>(
    `SELECT action FROM community_audit_logs WHERE community_id = $1`,
    [communityId],
  );
  const actions = audit.map((row) => row.action);
  for (const action of ['community.create', 'member.request', 'member.approve', 'member.role']) {
    assert.ok(actions.includes(action), `missing audit action ${action}`);
  }
});

test('community audience and community album work through the API-created membership', async () => {
  const post = await api.post('/v1/posts').set(auth(member.token)).send({
    clientPostId: 'community_post_0001',
    kind: 'text',
    audience: 'community',
    communityId,
    caption: 'Latihan malam ini.',
  });
  assert.equal(post.status, 201, JSON.stringify(post.body));
  assert.equal((await api.get(`/v1/posts/${post.body.id}`).set(auth(pending.token))).status, 200);
  assert.equal((await api.get(`/v1/posts/${post.body.id}`).set(auth(outsider.token))).status, 404);

  const album = await api.post('/v1/albums').set(auth(member.token)).send({
    clientAlbumId: 'community_album_0001',
    title: 'Album Komunitas',
    visibility: 'community',
    communityId,
  });
  assert.equal(album.status, 201, JSON.stringify(album.body));

  const media = await uploadImage(api, member.token, 'community_album_media_1', 'album_photo');
  const attached = await api
    .post(`/v1/albums/${album.body.id}/media`)
    .set(auth(member.token))
    .send({ mediaId: media.id, caption: 'Titik kumpul' });
  assert.equal(attached.status, 200, JSON.stringify(attached.body));
  assert.equal(attached.body.media.length, 1);
  assert.equal(attached.body.media[0].moderationStatus, 'pending');

  const memberAlbums = await api.get(`/v1/communities/${communityId}/albums`).set(auth(pending.token));
  assert.equal(memberAlbums.status, 200, JSON.stringify(memberAlbums.body));
  assert.ok(memberAlbums.body.items.some((item: { id: string }) => item.id === album.body.id));
  assert.equal((await api.get(`/v1/communities/${communityId}/albums`).set(auth(outsider.token))).status, 404);

  const outsiderAlbum = await api.post('/v1/albums').set(auth(outsider.token)).send({
    clientAlbumId: 'community_album_0002',
    title: 'Album Orang Luar',
    visibility: 'community',
    communityId,
  });
  assert.equal(outsiderAlbum.status, 403);
});

test('public communities join immediately and declined requests can be retried', async () => {
  const publicCommunity = await api.post('/v1/communities').set(auth(owner.token)).send({
    slug: 'terbuka',
    name: 'Komunitas Terbuka',
    visibility: 'public',
  });
  assert.equal(publicCommunity.status, 201, JSON.stringify(publicCommunity.body));
  const publicJoin = await api.post(`/v1/communities/${publicCommunity.body.id}/join`).set(auth(outsider.token));
  assert.equal(publicJoin.status, 200);
  assert.equal(publicJoin.body.status, 'active');

  const privateCommunity = await api.post('/v1/communities').set(auth(owner.token)).send({
    slug: 'tertutup',
    name: 'Komunitas Tertutup',
    visibility: 'private',
  });
  assert.equal(privateCommunity.status, 201, JSON.stringify(privateCommunity.body));
  const request = await api.post(`/v1/communities/${privateCommunity.body.id}/join`).set(auth(pending.token));
  assert.equal(request.body.status, 'requested');

  const declined = await api
    .post(`/v1/communities/${privateCommunity.body.id}/join-requests/${pending.id}/decline`)
    .set(auth(owner.token));
  assert.equal(declined.status, 200, JSON.stringify(declined.body));
  assert.equal(declined.body.status, 'left');
  assert.equal(declined.body.approved, false);

  const afterDecline = await api
    .get(`/v1/communities/${privateCommunity.body.id}/join-requests`)
    .set(auth(owner.token));
  assert.equal(afterDecline.body.items.length, 0);

  const retry = await api.post(`/v1/communities/${privateCommunity.body.id}/join`).set(auth(pending.token));
  assert.equal(retry.status, 200);
  assert.equal(retry.body.status, 'requested');
  assert.equal(retry.body.duplicate, false);
});
