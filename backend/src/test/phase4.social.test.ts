import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { v7 as uuidv7 } from 'uuid';
import { PGliteDatabase } from './pglite.database.js';
import { runMigrations } from '../db/migrate.js';
import { buildTestApp } from './app.factory.js';
import { auth, registerUser, uploadImage, type TestApi } from './phase4.helpers.js';

let db: PGliteDatabase;
let app: INestApplication;
let server: unknown;
let api: TestApi;
let A: { token: string; id: string };
let B: { token: string; id: string };
let C: { token: string; id: string };
let D: { token: string; id: string };
let communityId = '';
let privatePostId = '';
let publicPostId = '';
let followersPostId = '';
let communityPostId = '';
let albumPhotoMedia = '';

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.PLATE_ENCRYPTION_KEY = Buffer.alloc(32, 11).toString('base64');
  process.env.MEDIA_S3_BUCKET = 'riderjourney-test';
  process.env.MEDIA_S3_ACCESS_KEY = 'test-access';
  process.env.MEDIA_S3_SECRET_KEY = 'test-secret';
  process.env.MEDIA_S3_ENDPOINT = 'https://storage.example.test';
  db = await PGliteDatabase.create();
  const applied = await runMigrations(db);
  assert.deepEqual(applied, [
    '0001_init.sql', '0002_convoys.sql', '0003_phase3.sql',
    '0004_phase4.sql', '0005_community.sql', '0006_phase4_social.sql', '0007_phase5.sql', '0008_phase1.sql',
  ]);
  const built = await buildTestApp(db);
  app = built.app;
  server = app.getHttpServer();
  api = request(server as Parameters<typeof request>[0]) as unknown as TestApi;

  A = await registerUser(api, 'rider_alpha', 'Rider Alpha');
  B = await registerUser(api, 'rider_bravo', 'Rider Bravo');
  C = await registerUser(api, 'rider_charlie', 'Rider Charlie');
  D = await registerUser(api, 'rider_delta', 'Rider Delta');

  communityId = uuidv7();
  await db.query(
    `INSERT INTO communities (id, slug, name, owner_id) VALUES ($1, 'malam', 'Rider Malam', $2)`,
    [communityId, A.id],
  );
  await db.query(
    `INSERT INTO community_members (community_id, user_id, role, status, joined_at) VALUES
       ($1, $2, 'owner', 'active', now()), ($1, $3, 'member', 'active', now())`,
    [communityId, A.id, B.id],
  );
  await db.query(
    `INSERT INTO community_role_permissions (community_id, role, permission) VALUES
       ($1, 'member', 'post.create'), ($1, 'member', 'album.create')`,
    [communityId],
  );

  albumPhotoMedia = (await uploadImage(api, A.token, 'album_photo_alpha_1', 'album_photo')).id;
});

after(async () => {
  await app.close();
  await db.close();
});

test('audience visibility: private, public, followers, and community', async () => {
  const privatePost = await api.post('/v1/posts').set(auth(A.token)).send({
    clientPostId: 'post_private_0001', kind: 'text', audience: 'private', caption: 'hanya untukku',
  });
  assert.equal(privatePost.status, 201, JSON.stringify(privatePost.body));
  privatePostId = privatePost.body.id;
  assert.equal((await api.get(`/v1/posts/${privatePostId}`).set(auth(B.token))).status, 404);
  assert.equal((await api.get(`/v1/posts/${privatePostId}`).set(auth(A.token))).status, 200);

  const publicPost = await api.post('/v1/posts').set(auth(A.token)).send({
    clientPostId: 'post_public_0001', kind: 'text', audience: 'public', caption: 'semua boleh lihat',
  });
  assert.equal(publicPost.status, 201, JSON.stringify(publicPost.body));
  publicPostId = publicPost.body.id;
  assert.equal((await api.get(`/v1/posts/${publicPostId}`).set(auth(B.token))).status, 200);

  const followersPost = await api.post('/v1/posts').set(auth(A.token)).send({
    clientPostId: 'post_followers_0001', kind: 'text', audience: 'followers', caption: 'khusus pengikut',
  });
  assert.equal(followersPost.status, 201, JSON.stringify(followersPost.body));
  followersPostId = followersPost.body.id;
  assert.equal((await api.get(`/v1/posts/${followersPostId}`).set(auth(C.token))).status, 404);
  const follow = await api.post(`/v1/users/${A.id}/follow`).set(auth(C.token));
  assert.equal(follow.status, 200);
  assert.equal(follow.body.following, true);
  assert.equal((await api.get(`/v1/posts/${followersPostId}`).set(auth(C.token))).status, 200);

  const communityPost = await api.post('/v1/posts').set(auth(A.token)).send({
    clientPostId: 'post_community_0001', kind: 'text', audience: 'community', communityId, caption: 'khusus anggota',
  });
  assert.equal(communityPost.status, 201, JSON.stringify(communityPost.body));
  communityPostId = communityPost.body.id;
  assert.equal((await api.get(`/v1/posts/${communityPostId}`).set(auth(B.token))).status, 200);
  assert.equal((await api.get(`/v1/posts/${communityPostId}`).set(auth(C.token))).status, 404);

  // A private account turns a follow into a request; only acceptance reveals followers-only posts.
  const privateAccount = await api.patch('/v1/me/rider-profile').set(auth(A.token)).send({ feedVisibility: 'private' });
  assert.equal(privateAccount.status, 200);
  const requestFollow = await api.post(`/v1/users/${A.id}/follow`).set(auth(D.token));
  assert.equal(requestFollow.status, 200);
  assert.equal(requestFollow.body.requested, true);
  assert.equal(requestFollow.body.following, false);
  assert.equal((await api.get(`/v1/posts/${followersPostId}`).set(auth(D.token))).status, 404);
  const requests = await api.get('/v1/me/follow-requests').set(auth(A.token));
  assert.ok(requests.body.items.some((item: { requesterId: string }) => item.requesterId === D.id));
  const accepted = await api.post(`/v1/me/follow-requests/${D.id}/accept`).set(auth(A.token));
  assert.equal(accepted.status, 200);
  assert.equal((await api.get(`/v1/posts/${followersPostId}`).set(auth(D.token))).status, 200);
});

test('feed and hashtag pagination are keyset pages without overlap', async () => {
  const created: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const post = await api.post('/v1/posts').set(auth(A.token)).send({
      clientPostId: `post_page_${i}_0001`,
      kind: 'text',
      audience: 'public',
      caption: `halaman ${i} #pagination`,
    });
    assert.equal(post.status, 201, JSON.stringify(post.body));
    created.push(post.body.id);
  }
  const seen: string[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 3; page += 1) {
    const query = new URLSearchParams({ limit: '2' });
    if (cursor) query.set('cursor', cursor);
    const response = await api.get(`/v1/hashtags/pagination/posts?${query}`).set(auth(B.token));
    assert.equal(response.status, 200, JSON.stringify(response.body));
    seen.push(...response.body.items.map((item: { id: string }) => item.id));
    cursor = response.body.nextCursor;
  }
  assert.equal(cursor, null);
  assert.equal(seen.length, 5);
  assert.equal(new Set(seen).size, 5);
  assert.deepEqual(seen, [...created].reverse());

  const feed = await api.get('/v1/feed?limit=3').set(auth(B.token));
  assert.equal(feed.status, 200);
  assert.equal(feed.body.items.length, 3);
  assert.ok(feed.body.nextCursor);
  const next = await api.get(`/v1/feed?limit=3&cursor=${encodeURIComponent(feed.body.nextCursor)}`).set(auth(B.token));
  assert.equal(next.status, 200);
  const overlap = next.body.items.filter((item: { id: string }) =>
    feed.body.items.some((first: { id: string }) => first.id === item.id));
  assert.equal(overlap.length, 0);
});

test('reaction idempotency and comment pagination', async () => {
  const first = await api.post(`/v1/posts/${publicPostId}/reactions`).set(auth(B.token)).send({ kind: 'like', clientId: 'reaction_like_0001' });
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.duplicate, false);
  const retry = await api.post(`/v1/posts/${publicPostId}/reactions`).set(auth(B.token)).send({ kind: 'like', clientId: 'reaction_like_0001' });
  assert.equal(retry.body.duplicate, true);
  const changed = await api.post(`/v1/posts/${publicPostId}/reactions`).set(auth(B.token)).send({ kind: 'love', clientId: 'reaction_love_0001' });
  assert.equal(changed.body.duplicate, false);
  assert.equal(changed.body.kind, 'love');
  const detail = await api.get(`/v1/posts/${publicPostId}`).set(auth(A.token));
  assert.equal(detail.body.reactionCount, 1);
  assert.equal(detail.body.viewerReaction, null);

  const comments: string[] = [];
  for (let i = 0; i < 5; i += 1) {
    const comment = await api.post(`/v1/posts/${publicPostId}/comments`).set(auth(B.token)).send({
      clientId: `comment_page_${i}_0001`, body: `komentar ${i}`,
    });
    assert.equal(comment.status, 201, JSON.stringify(comment.body));
    comments.push(comment.body.id);
  }
  const dup = await api.post(`/v1/posts/${publicPostId}/comments`).set(auth(B.token)).send({
    clientId: 'comment_page_0_0001', body: 'komentar 0',
  });
  assert.equal(dup.body.duplicate, true);
  assert.equal(dup.body.id, comments[0]);

  const pageOne = await api.get(`/v1/posts/${publicPostId}/comments?limit=2`).set(auth(A.token));
  assert.equal(pageOne.body.items.length, 2);
  const pageTwo = await api.get(`/v1/posts/${publicPostId}/comments?limit=2&cursor=${encodeURIComponent(pageOne.body.nextCursor)}`).set(auth(A.token));
  assert.equal(pageTwo.body.items.length, 2);
  const pageThree = await api.get(`/v1/posts/${publicPostId}/comments?limit=2&cursor=${encodeURIComponent(pageTwo.body.nextCursor)}`).set(auth(A.token));
  assert.equal(pageThree.body.items.length, 1);
  assert.equal(pageThree.body.nextCursor, null);

  const reaction = await api.post(`/v1/comments/${comments[0]}/reactions`).set(auth(A.token)).send({ kind: 'respect', clientId: 'comment_reaction_0001' });
  assert.equal(reaction.status, 200);
  const reactionRetry = await api.post(`/v1/comments/${comments[0]}/reactions`).set(auth(A.token)).send({ kind: 'respect', clientId: 'comment_reaction_0001' });
  assert.equal(reactionRetry.body.duplicate, true);

  const removed = await api.delete(`/v1/comments/${comments[0]}`).set(auth(B.token));
  assert.equal(removed.status, 200);
  const afterDelete = await api.get(`/v1/posts/${publicPostId}/comments?limit=10`).set(auth(A.token));
  assert.equal(afterDelete.body.items.length, 4);
});

test('save, mention, report, block, and mute', async () => {
  const saved = await api.post(`/v1/posts/${publicPostId}/save`).set(auth(B.token));
  assert.equal(saved.status, 200);
  const saves = await api.get('/v1/me/saves').set(auth(B.token));
  assert.ok(saves.body.items.some((item: { id: string }) => item.id === publicPostId));

  const mentionPost = await api.post('/v1/posts').set(auth(B.token)).send({
    clientPostId: 'post_mention_0001', kind: 'text', audience: 'public', caption: 'halo @rider_alpha #kenalan',
  });
  assert.equal(mentionPost.status, 201, JSON.stringify(mentionPost.body));
  const mentions = await db.query<{ mentioned_id: string }>(`SELECT mentioned_id FROM mentions WHERE post_id = $1`, [mentionPost.body.id]);
  assert.equal(mentions.length, 1);
  assert.equal(mentions[0].mentioned_id, A.id);
  const tags = await db.query<{ tag: string }>(`SELECT tag FROM post_hashtags WHERE post_id = $1`, [mentionPost.body.id]);
  assert.deepEqual(tags.map((row) => row.tag), ['kenalan']);

  const report = await api.post('/v1/reports').set(auth(C.token)).send({
    targetType: 'post', targetId: publicPostId, reason: 'spam', clientReportId: 'report_post_0001',
  });
  assert.equal(report.status, 201, JSON.stringify(report.body));
  const reportRetry = await api.post('/v1/reports').set(auth(C.token)).send({
    targetType: 'post', targetId: publicPostId, reason: 'spam', clientReportId: 'report_post_0001',
  });
  assert.equal(reportRetry.body.duplicate, true);
  const missing = await api.post('/v1/reports').set(auth(C.token)).send({
    targetType: 'post', targetId: uuidv7(), reason: 'spam', clientReportId: 'report_post_0002',
  });
  assert.equal(missing.status, 404);

  const block = await api.post(`/v1/users/${A.id}/block`).set(auth(C.token));
  assert.equal(block.status, 200);
  assert.equal((await api.get(`/v1/posts/${publicPostId}`).set(auth(C.token))).status, 404);
  const blockedFeed = await api.get('/v1/feed?limit=50').set(auth(C.token));
  assert.equal(blockedFeed.body.items.some((item: { author: { id: string } }) => item.author.id === A.id), false);
  const blockedList = await api.get('/v1/me/blocked').set(auth(C.token));
  assert.ok(blockedList.body.items.some((item: { id: string }) => item.id === A.id));
  await api.delete(`/v1/users/${A.id}/block`).set(auth(C.token));
  assert.equal((await api.get(`/v1/posts/${publicPostId}`).set(auth(C.token))).status, 200);

  await api.post(`/v1/users/${B.id}/mute`).set(auth(A.token));
  const mutedPost = await api.post('/v1/posts').set(auth(B.token)).send({
    clientPostId: 'post_muted_0001', kind: 'text', audience: 'public', caption: 'post yang dibisukan',
  });
  assert.equal(mutedPost.status, 201, JSON.stringify(mutedPost.body));
  const afterMute = await api.get('/v1/feed?limit=50').set(auth(A.token));
  assert.equal(afterMute.body.items.some((item: { id: string }) => item.id === mutedPost.body.id), false);
  assert.equal((await api.get(`/v1/posts/${mutedPost.body.id}`).set(auth(A.token))).status, 200);
  await api.delete(`/v1/users/${B.id}/mute`).set(auth(A.token));
});

test('albums enforce visibility, quota, permission, and moderation', async () => {
  const privateAlbum = await api.post('/v1/albums').set(auth(A.token)).send({
    clientAlbumId: 'album_private_0001', title: 'Album Pribadi', visibility: 'private',
  });
  assert.equal(privateAlbum.status, 201, JSON.stringify(privateAlbum.body));
  assert.equal((await api.get(`/v1/albums/${privateAlbum.body.id}`).set(auth(B.token))).status, 404);

  const publicAlbum = await api.post('/v1/albums').set(auth(A.token)).send({
    clientAlbumId: 'album_public_0001', title: 'Album Publik', visibility: 'public',
  });
  assert.equal(publicAlbum.status, 201, JSON.stringify(publicAlbum.body));
  assert.equal((await api.get(`/v1/albums/${publicAlbum.body.id}`).set(auth(B.token))).status, 200);

  const attached = await api.post(`/v1/albums/${publicAlbum.body.id}/media`).set(auth(A.token)).send({
    mediaId: albumPhotoMedia, caption: 'foto pertama', width: 1200, height: 800,
  });
  assert.equal(attached.status, 200, JSON.stringify(attached.body));
  assert.equal(attached.body.media.length, 1);
  assert.equal(attached.body.media[0].moderationStatus, 'approved');
  const duplicate = await api.post(`/v1/albums/${publicAlbum.body.id}/media`).set(auth(A.token)).send({ mediaId: albumPhotoMedia });
  assert.equal(duplicate.body.duplicate, true);
  assert.equal(Number(duplicate.body.usedBytes), 11);

  const forbidden = await api.post(`/v1/albums/${privateAlbum.body.id}/media`).set(auth(B.token)).send({ mediaId: albumPhotoMedia });
  assert.equal(forbidden.status, 403);

  const quotaAlbum = await api.post('/v1/albums').set(auth(A.token)).send({
    clientAlbumId: 'album_quota_0001', title: 'Album Kuota', visibility: 'private',
  });
  await db.query(`UPDATE albums SET quota_bytes = 10 WHERE id = $1`, [quotaAlbum.body.id]);
  const extraMedia = await uploadImage(api, A.token, 'album_photo_alpha_2', 'album_photo');
  const overQuota = await api.post(`/v1/albums/${quotaAlbum.body.id}/media`).set(auth(A.token)).send({ mediaId: extraMedia.id });
  assert.equal(overQuota.status, 409, JSON.stringify(overQuota.body));
  assert.equal(overQuota.body.code, 'ALBUM_QUOTA_EXCEEDED');

  const communityAlbum = await api.post('/v1/albums').set(auth(B.token)).send({
    clientAlbumId: 'album_community_0001', title: 'Album Komunitas', visibility: 'community', communityId,
  });
  assert.equal(communityAlbum.status, 201, JSON.stringify(communityAlbum.body));
  const outsiderAlbum = await api.post('/v1/albums').set(auth(C.token)).send({
    clientAlbumId: 'album_community_0002', title: 'Album Orang Luar', visibility: 'community', communityId,
  });
  assert.equal(outsiderAlbum.status, 403);
  assert.equal((await api.get(`/v1/albums/${communityAlbum.body.id}`).set(auth(C.token))).status, 404);

  const communityMedia = await uploadImage(api, B.token, 'album_photo_bravo_1', 'album_photo');
  const added = await api.post(`/v1/albums/${communityAlbum.body.id}/media`).set(auth(B.token)).send({ mediaId: communityMedia.id });
  assert.equal(added.status, 200, JSON.stringify(added.body));
  assert.equal(added.body.media[0].moderationStatus, 'pending');
  const reviewed = await api.post(`/v1/albums/${communityAlbum.body.id}/media/${communityMedia.id}/review`).set(auth(A.token)).send({ status: 'approved' });
  assert.equal(reviewed.status, 200, JSON.stringify(reviewed.body));
  const visible = await api.get(`/v1/albums/${communityAlbum.body.id}`).set(auth(B.token));
  assert.equal(visible.body.media[0].moderationStatus, 'approved');

  const removeMedia = await api.delete(`/v1/albums/${communityAlbum.body.id}/media/${communityMedia.id}`).set(auth(B.token));
  assert.equal(removeMedia.status, 200);
  const afterRemove = await api.get(`/v1/albums/${communityAlbum.body.id}`).set(auth(B.token));
  assert.equal(Number(afterRemove.body.usedBytes), 0);

  const deleted = await api.delete(`/v1/albums/${privateAlbum.body.id}`).set(auth(A.token));
  assert.equal(deleted.status, 200);
  assert.equal(deleted.body.deleted, true);
  assert.equal((await api.get(`/v1/albums/${privateAlbum.body.id}`).set(auth(A.token))).status, 404);
});
