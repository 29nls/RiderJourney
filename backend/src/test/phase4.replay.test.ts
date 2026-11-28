import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PGliteDatabase } from './pglite.database.js';
import { runMigrations } from '../db/migrate.js';
import { buildTestApp } from './app.factory.js';
import { MediaService } from '../media/media.service.js';
import { auth, jpegBody, registerUser, sha256Hex, uploadImage, type TestApi } from './phase4.helpers.js';
import { testStorage } from './fake-storage.js';

let db: PGliteDatabase;
let app: INestApplication;
let api: TestApi;
let A: { token: string; id: string };
let B: { token: string; id: string };
let C: { token: string; id: string };
let finishedTrip = '';
let activeTrip = '';
let privateMedia = '';

const PNG_HEAD = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00]);
const MP4_HEAD = Buffer.from([0x00, 0x00, 0x00, 0x18, 0x66, 0x74, 0x79, 0x70, 0x6d, 0x70, 0x34, 0x32]);

before(async () => {
  process.env.NODE_ENV = 'test';
  process.env.PLATE_ENCRYPTION_KEY = Buffer.alloc(32, 13).toString('base64');
  process.env.MEDIA_S3_BUCKET = 'riderjourney-test';
  process.env.MEDIA_S3_ACCESS_KEY = 'test-access';
  process.env.MEDIA_S3_SECRET_KEY = 'test-secret';
  process.env.MEDIA_S3_ENDPOINT = 'https://storage.example.test';
  db = await PGliteDatabase.create();
  const applied = await runMigrations(db);
  assert.deepEqual(applied, [
    '0001_init.sql', '0002_convoys.sql', '0003_phase3.sql',
    '0004_phase4.sql', '0005_community.sql', '0006_phase4_social.sql', '0007_phase5.sql', '0008_phase1.sql', '0009_phase6.sql', '0010_phase6_1.sql', '0011_phase6_2.sql', '0012_phase6_3.sql', '0013_phase6_4.sql',
  ]);
  const built = await buildTestApp(db);
  app = built.app;
  api = request(app.getHttpServer() as Parameters<typeof request>[0]) as unknown as TestApi;
  A = await registerUser(api, 'replay_alpha', 'Replay Alpha');
  B = await registerUser(api, 'replay_bravo', 'Replay Bravo');
  C = await registerUser(api, 'replay_charlie', 'Replay Charlie');
});

after(async () => {
  await app.close();
  await db.close();
});

test('upload validation rejects size, type, and unverifiable content', async () => {
  const jpeg = jpegBody(1024);
  const checksum = sha256Hex(jpeg);
  const tooLarge = await api.post('/v1/media/uploads').set(auth(A.token)).send({
    purpose: 'post_photo', contentType: 'image/jpeg', sizeBytes: 5_242_881, clientMediaId: 'too_large_0001', checksumSha256: checksum,
  });
  assert.equal(tooLarge.status, 422);
  assert.equal(tooLarge.body.code, 'MEDIA_TOO_LARGE');

  const noChecksum = await api.post('/v1/media/uploads').set(auth(A.token)).send({
    purpose: 'post_photo', contentType: 'image/jpeg', sizeBytes: 1024, clientMediaId: 'no_checksum_0001',
  });
  assert.equal(noChecksum.status, 422);

  const photoWithVideo = await api.post('/v1/media/uploads').set(auth(A.token)).send({
    purpose: 'post_photo', contentType: 'video/mp4', sizeBytes: 1024, clientMediaId: 'wrong_type_0001', checksumSha256: checksum,
  });
  assert.equal(photoWithVideo.status, 422);
  assert.equal(photoWithVideo.body.code, 'MEDIA_TYPE_UNSUPPORTED');

  const videoWithPhoto = await api.post('/v1/media/uploads').set(auth(A.token)).send({
    purpose: 'post_video', contentType: 'image/jpeg', sizeBytes: 1024, clientMediaId: 'wrong_type_0002', checksumSha256: checksum,
  });
  assert.equal(videoWithPhoto.status, 422);

  const retryId = 'retry_intent_0001';
  const first = await api.post('/v1/media/uploads').set(auth(A.token)).send({
    purpose: 'post_photo', contentType: 'image/jpeg', sizeBytes: jpeg.length, clientMediaId: retryId, checksumSha256: checksum,
  });
  assert.equal(first.status, 201);
  const second = await api.post('/v1/media/uploads').set(auth(A.token)).send({
    purpose: 'post_photo', contentType: 'image/jpeg', sizeBytes: jpeg.length, clientMediaId: retryId, checksumSha256: checksum,
  });
  assert.equal(second.status, 201);
  assert.equal(second.body.id, first.body.id);
  assert.ok(second.body.uploadUrl);
  const key = (url: string) => new URL(url).pathname.replace(/^\//, '');

  // Magic bytes disagree with the declared JPEG type, even though size and
  // checksum match: the server must reject it.
  const png = Buffer.concat([PNG_HEAD, Buffer.alloc(8)]);
  const mismatchIntent = await api.post('/v1/media/uploads').set(auth(A.token)).send({
    purpose: 'post_photo', contentType: 'image/jpeg', sizeBytes: png.length, clientMediaId: 'mismatch_0001', checksumSha256: sha256Hex(png),
  });
  assert.equal(mismatchIntent.status, 201, JSON.stringify(mismatchIntent.body));
  testStorage.put(key(mismatchIntent.body.uploadUrl), png, 'image/jpeg');
  const mismatch = await api.post(`/v1/media/uploads/${mismatchIntent.body.id}/complete`).set(auth(A.token));
  assert.equal(mismatch.status, 409, JSON.stringify(mismatch.body));
  assert.equal(mismatch.body.code, 'MEDIA_CONTENT_MISMATCH');

  // Same length, different bytes: the stored SHA-256 no longer matches.
  const tampered = Buffer.from(jpeg);
  tampered[20] = tampered[20] ^ 0xff;
  const checksumIntent = await api.post('/v1/media/uploads').set(auth(A.token)).send({
    purpose: 'post_photo', contentType: 'image/jpeg', sizeBytes: jpeg.length, clientMediaId: 'checksum_0001', checksumSha256: checksum,
  });
  assert.equal(checksumIntent.status, 201, JSON.stringify(checksumIntent.body));
  testStorage.put(key(checksumIntent.body.uploadUrl), tampered, 'image/jpeg');
  const checksumMismatch = await api.post(`/v1/media/uploads/${checksumIntent.body.id}/complete`).set(auth(A.token));
  assert.equal(checksumMismatch.status, 409, JSON.stringify(checksumMismatch.body));
  assert.equal(checksumMismatch.body.code, 'MEDIA_CHECKSUM_MISMATCH');

  // HEAD length is authoritative; the declared size is never trusted.
  const shortIntent = await api.post('/v1/media/uploads').set(auth(A.token)).send({
    purpose: 'post_photo', contentType: 'image/jpeg', sizeBytes: jpeg.length, clientMediaId: 'short_0001', checksumSha256: checksum,
  });
  assert.equal(shortIntent.status, 201, JSON.stringify(shortIntent.body));
  testStorage.put(key(shortIntent.body.uploadUrl), jpeg.subarray(0, jpeg.length - 1), 'image/jpeg');
  const short = await api.post(`/v1/media/uploads/${shortIntent.body.id}/complete`).set(auth(A.token));
  assert.equal(short.status, 409, JSON.stringify(short.body));
  assert.equal(short.body.code, 'MEDIA_SIZE_MISMATCH');

  const mp4 = Buffer.concat([MP4_HEAD, Buffer.alloc(4)]);
  const video = await api.post('/v1/media/uploads').set(auth(A.token)).send({
    purpose: 'post_video', contentType: 'video/mp4', sizeBytes: mp4.length, clientMediaId: 'video_clip_0001', checksumSha256: sha256Hex(mp4),
  });
  assert.equal(video.status, 201, JSON.stringify(video.body));
  testStorage.put(key(video.body.uploadUrl), mp4, 'video/mp4');
  const completeVideo = await api.post(`/v1/media/uploads/${video.body.id}/complete`).set(auth(A.token));
  assert.equal(completeVideo.status, 200, JSON.stringify(completeVideo.body));
  assert.equal(completeVideo.body.status, 'ready');
});

test('signed URLs gate private media by access and expiry', async () => {
  privateMedia = (await uploadImage(api, A.token, 'signed_private_0001')).id;
  const post = await api.post('/v1/posts').set(auth(A.token)).send({
    clientPostId: 'post_signed_private_0001', kind: 'photo', audience: 'private', mediaIds: [privateMedia],
  });
  assert.equal(post.status, 201, JSON.stringify(post.body));

  assert.equal((await api.get(`/v1/media/${privateMedia}/url`).set(auth(B.token))).status, 404);
  // Phase 6.6 fail-closed: private posts are moderated, so the owner gets a URL
  // only once the scan is clean, and anonymous redemption waits for the
  // reviewer. Both gates are covered in phase6_6.test.ts; here the rest of the
  // signed-URL rules (scope, tamper, expiry, instr, public share) are checked.
  const signed = await api.get(`/v1/media/${privateMedia}/url`).set(auth(A.token));
  assert.equal(signed.status, 200, JSON.stringify(signed.body));
  assert.equal(signed.body.url, null, 'unscanned private media has no bytes yet');
  await db.query(`UPDATE media_assets SET scan_status = 'clean', moderation_status = 'approved' WHERE id = $1`, [privateMedia]);
  const granted = await api.get(`/v1/media/${privateMedia}/url`).set(auth(A.token));
  assert.equal(granted.status, 200, JSON.stringify(granted.body));
  const served = await api.get(granted.body.url);
  assert.equal(served.status, 200, JSON.stringify(served.body));
  assert.equal(served.body.id, privateMedia);

  const tampered = await api.get((granted.body.url as string).replace(/signature=[^&]+$/, 'signature=deadbeef'));
  assert.equal(tampered.status, 401);
  assert.equal(tampered.body.code, 'SIGNED_URL_INVALID');

  const mediaService = app.get(MediaService);
  const expired = await mediaService.signGet(A.id, privateMedia, -1);
  assert.ok(expired.url, 'private media of its own owner still mints a URL');
  const expiredResponse = await api.get(expired.url as string);
  assert.equal(expiredResponse.status, 401);
  assert.equal(expiredResponse.body.code, 'SIGNED_URL_EXPIRED');

  const publicMedia = await uploadImage(api, A.token, 'signed_public_0001');
  const publicPost = await api.post('/v1/posts').set(auth(A.token)).send({
    clientPostId: 'post_signed_public_0001', kind: 'photo', audience: 'public', mediaIds: [publicMedia.id],
  });
  assert.equal(publicPost.status, 201, JSON.stringify(publicPost.body));
  // Phase 6.3 is fail-closed on scan state: a public post is not enough while
  // the media has not been scanned. Marking it clean models a completed scan.
  const unscanned = await api.get(`/v1/media/${publicMedia.id}/url`).set(auth(B.token));
  assert.equal(unscanned.status, 404, 'unscanned media must not be served publicly');
  await db.query(`UPDATE media_assets SET scan_status = 'clean' WHERE id = $1`, [publicMedia.id]);
  // Phase 6.4 adds a second, independent gate: community content is only public
  // once a reviewer approves it, even when the file itself is clean.
  const cleanButUnreviewed = await api.get(`/v1/media/${publicMedia.id}/url`).set(auth(B.token));
  assert.equal(cleanButUnreviewed.status, 404, 'unreviewed content stays private');
  await db.query(`UPDATE media_assets SET moderation_status = 'approved' WHERE id = $1`, [publicMedia.id]);
  const shared = await api.get(`/v1/media/${publicMedia.id}/url`).set(auth(B.token));
  assert.equal(shared.status, 200, JSON.stringify(shared.body));
});

test('trip replay excludes GPS noise, models gaps, and exposes photo markers', async () => {
  const started = await api.post('/v1/trips').set(auth(A.token)).send({});
  assert.equal(started.status, 201, JSON.stringify(started.body));
  finishedTrip = started.body.id;
  const points = await api.post(`/v1/trips/${finishedTrip}/points`).set(auth(A.token)).send({
    points: [
      { seq: 1, lat: -6.2, lng: 106.8, accuracyM: 5, recordedAt: new Date(Date.now() - 300_000).toISOString() },
      { seq: 2, lat: -6.2002, lng: 106.8002, accuracyM: 5, recordedAt: new Date(Date.now() - 295_000).toISOString() },
      { seq: 3, lat: -6.201, lng: 106.801, accuracyM: 5, recordedAt: new Date(Date.now() - 290_000).toISOString() },
      { seq: 4, lat: -6.6, lng: 107.3, accuracyM: 5, recordedAt: new Date(Date.now() - 285_000).toISOString() },
      { seq: 5, lat: -6.202, lng: 106.802, accuracyM: 500, recordedAt: new Date(Date.now() - 280_000).toISOString() },
      { seq: 6, lat: -6.203, lng: 106.803, accuracyM: 5, recordedAt: new Date(Date.now() - 100_000).toISOString() },
      { seq: 7, lat: -6.204, lng: 106.804, accuracyM: 5, recordedAt: new Date(Date.now() - 95_000).toISOString() },
      { seq: 8, lat: -6.205, lng: 106.805, accuracyM: 5, recordedAt: new Date(Date.now() - 90_000).toISOString() },
    ],
  });
  assert.equal(points.status, 200, JSON.stringify(points.body));
  const finished = await api.post(`/v1/trips/${finishedTrip}/finish`).set(auth(A.token));
  assert.equal(finished.status, 200);

  const replay = await api.get(`/v1/trips/${finishedTrip}/replay`).set(auth(A.token));
  assert.equal(replay.status, 200, JSON.stringify(replay.body));
  assert.equal(replay.body.stats.gaps, 1);
  assert.ok(replay.body.stats.spikeCount >= 1);
  assert.ok(replay.body.stats.lowAccuracyCount >= 1);
  assert.equal(replay.body.stats.acceptedPoints, 5);
  assert.ok(replay.body.stats.distanceM < 5000, `distance ${replay.body.stats.distanceM} should exclude the spike`);
  assert.equal(replay.body.stats.verified, true);
  assert.equal(replay.body.playback.segments.length, 2);
  assert.ok(replay.body.playback.timeline.length > 0);

  const photo = await uploadImage(api, A.token, 'trip_photo_0001', 'post_photo');
  const attached = await api.post(`/v1/trips/${finishedTrip}/photos`).set(auth(A.token)).send({
    mediaId: photo.id, positionM: 100, takenAt: new Date().toISOString(),
  });
  assert.equal(attached.status, 201, JSON.stringify(attached.body));
  const withMarker = await api.get(`/v1/trips/${finishedTrip}/replay`).set(auth(A.token));
  assert.equal(withMarker.body.markers.length, 1);
  assert.equal(withMarker.body.markers[0].positionM, 100);
  assert.equal(typeof withMarker.body.markers[0].lat, 'number');

  assert.equal((await api.get(`/v1/trips/${finishedTrip}/replay`).set(auth(B.token))).status, 404);
  const shared = await api.patch(`/v1/trips/${finishedTrip}/share`).set(auth(A.token)).send({ userIds: [B.id] });
  assert.equal(shared.status, 200);
  assert.equal((await api.get(`/v1/trips/${finishedTrip}/replay`).set(auth(B.token))).status, 200);
  const foreignPhoto = await api.post(`/v1/trips/${finishedTrip}/photos`).set(auth(B.token)).send({
    mediaId: photo.id, positionM: 10,
  });
  assert.equal(foreignPhoto.status, 404);

  const segments = await db.query<{ count: string }>(`SELECT count(*)::text AS count FROM trip_segments WHERE trip_id = $1`, [finishedTrip]);
  assert.equal(segments[0].count, '2');
  const summary = await db.query<{ verified: string }>(`SELECT summary->>'verified' AS verified FROM trips WHERE id = $1`, [finishedTrip]);
  assert.equal(summary[0].verified, 'true');
});

test('poster templates render SVG and export idempotently', async () => {
  const poster = await api.post(`/v1/trips/${finishedTrip}/posters`).set(auth(A.token)).send({
    template: 'night_odometer', title: 'Malam di Bandung', subtitle: 'Rute selatan', clientPosterId: 'poster_night_0001',
  });
  assert.equal(poster.status, 201, JSON.stringify(poster.body));
  assert.equal(poster.body.renderState, 'ready');
  assert.equal((await api.get(`/v1/trips/${finishedTrip}/posters`).set(auth(A.token))).body.items.length, 1);

  const svg = await api.get(`/v1/posters/${poster.body.id}/render.svg`).set(auth(A.token));
  assert.equal(svg.status, 200, JSON.stringify(svg.body));
  assert.match(String(svg.headers['content-type']), /image\/svg\+xml/);
  const markup = svg.text ?? (Buffer.isBuffer(svg.body) ? svg.body.toString('utf8') : String(svg.body));
  assert.match(markup, /^<svg/);
  assert.match(markup, /Malam di Bandung/);
  assert.match(markup, /ODOMETER/);

  const invalid = await api.post(`/v1/trips/${finishedTrip}/posters`).set(auth(A.token)).send({
    template: 'user_html', title: 'Nope', clientPosterId: 'poster_bad_0001',
  });
  assert.equal(invalid.status, 422);
  assert.equal((await api.get(`/v1/posters/${poster.body.id}`).set(auth(B.token))).status, 404);

  const firstExport = await api.post(`/v1/posters/${poster.body.id}/export`).set(auth(A.token));
  assert.equal(firstExport.status, 200);
  assert.equal(firstExport.body.exportCount, 1);
  const secondExport = await api.post(`/v1/posters/${poster.body.id}/export`).set(auth(A.token));
  assert.equal(secondExport.body.exportCount, 2);

  const started = await api.post('/v1/trips').set(auth(A.token)).send({});
  activeTrip = started.body.id;
  const unfinished = await api.post(`/v1/trips/${activeTrip}/posters`).set(auth(A.token)).send({
    template: 'first_light', title: 'Belum selesai', clientPosterId: 'poster_active_0001',
  });
  assert.equal(unfinished.status, 422);
  assert.equal(unfinished.body.code, 'TRIP_NOT_FINISHED');
  await api.post(`/v1/trips/${activeTrip}/finish`).set(auth(A.token));
});

test('points only from safe reasons and leaderboard is opt-in', async () => {
  const before = await api.get('/v1/leaderboard').set(auth(A.token));
  assert.equal(before.body.items.some((item: { userId: string }) => item.userId === A.id), false);
  assert.equal(before.body.optIn, false);

  const first = await api.post('/v1/me/safety-checklist').set(auth(A.token));
  assert.equal(first.status, 200, JSON.stringify(first.body));
  assert.equal(first.body.awarded, true);
  assert.ok(first.body.badgesAwarded.includes('pre_ride_check'));
  const retry = await api.post('/v1/me/safety-checklist').set(auth(A.token));
  assert.equal(retry.body.awarded, false);

  const evaluated = await api.post('/v1/me/badges/evaluate').set(auth(A.token));
  assert.deepEqual(evaluated.body.awarded, []);

  const points = await api.get('/v1/me/points').set(auth(A.token));
  assert.equal(points.body.total, 15);
  assert.equal(points.body.byReason.safety_checklist, 10);
  assert.equal(points.body.byReason.new_badge, 5);
  assert.match(points.body.policy, /Tidak ada poin untuk kecepatan/);

  const badges = await api.get('/v1/me/badges').set(auth(A.token));
  const preRide = badges.body.items.find((item: { code: string }) => item.code === 'pre_ride_check');
  assert.equal(preRide.earned, true);

  await assert.rejects(
    () => db.query(
      `INSERT INTO point_ledger (id, user_id, delta, reason, reference_type, reference_id)
       VALUES ('00000000-0000-7000-a000-000000000001', $1, 100, 'speeding', 'trip', $2)`,
      [A.id, finishedTrip],
    ),
    /check|constraint/i,
  );

  const optIn = await api.patch('/v1/me/rider-profile').set(auth(A.token)).send({ leaderboardOptIn: true });
  assert.equal(optIn.status, 200);
  assert.equal(optIn.body.leaderboardOptIn, true);
  const board = await api.get('/v1/leaderboard').set(auth(A.token));
  const mine = board.body.items.find((item: { userId: string }) => item.userId === A.id);
  assert.equal(mine.points, 15);
  assert.equal(mine.rank, 1);
  assert.deepEqual(board.body.me, mine);
});

test('notification preferences gate rows and push devices rotate', async () => {
  await api.post(`/v1/users/${A.id}/follow`).set(auth(B.token));
  const initial = await api.get('/v1/notifications?unread=true').set(auth(A.token));
  assert.ok(initial.body.unreadCount >= 1);
  assert.ok(initial.body.items.some((item: { kind: string; sourceUserId: string }) => item.kind === 'follow' && item.sourceUserId === B.id));

  await api.patch('/v1/me/notification-preferences').set(auth(A.token)).send({ follow: false });
  const suppressedBefore = (await api.get('/v1/notifications?unread=true').set(auth(A.token))).body.unreadCount;
  await api.post(`/v1/users/${A.id}/follow`).set(auth(C.token));
  const suppressedAfter = (await api.get('/v1/notifications?unread=true').set(auth(A.token))).body.unreadCount;
  assert.equal(suppressedAfter, suppressedBefore);

  await api.patch('/v1/me/notification-preferences').set(auth(A.token)).send({ follow: true });
  await api.delete(`/v1/users/${A.id}/follow`).set(auth(C.token));
  await api.post(`/v1/users/${A.id}/follow`).set(auth(C.token));
  const enabled = await api.get('/v1/notifications?unread=true').set(auth(A.token));
  assert.ok(enabled.body.items.some((item: { kind: string; sourceUserId: string }) => item.kind === 'follow' && item.sourceUserId === C.id));

  const postOne = await api.post('/v1/posts').set(auth(B.token)).send({
    clientPostId: 'post_notify_0001', kind: 'text', audience: 'public', caption: 'notifikasi satu',
  });
  await api.post(`/v1/posts/${postOne.body.id}/reactions`).set(auth(A.token)).send({ kind: 'like', clientId: 'like_notify_0001' });
  const likes = await api.get('/v1/notifications?limit=50').set(auth(B.token));
  assert.ok(likes.body.items.some((item: { kind: string; postId: string }) => item.kind === 'like' && item.postId === postOne.body.id));

  await api.patch('/v1/me/notification-preferences').set(auth(B.token)).send({ comment: false });
  const postTwo = await api.post('/v1/posts').set(auth(B.token)).send({
    clientPostId: 'post_notify_0002', kind: 'text', audience: 'public', caption: 'notifikasi dua',
  });
  await api.post(`/v1/posts/${postTwo.body.id}/reactions`).set(auth(A.token)).send({ kind: 'like', clientId: 'like_notify_0002' });
  const afterMute = await api.get('/v1/notifications?limit=50').set(auth(B.token));
  assert.equal(afterMute.body.items.some((item: { postId: string }) => item.postId === postTwo.body.id), false);

  const message = await db.query<{ id: string }>(
    `SELECT id FROM notifications WHERE user_id = $1 AND unread LIMIT 1`,
    [A.id],
  );
  const read = await api.post(`/v1/notifications/${message[0].id}/read`).set(auth(A.token));
  assert.equal(read.status, 200);
  assert.equal(read.body.unread, false);
  const readAll = await api.post('/v1/notifications/read-all').set(auth(A.token));
  assert.ok(readAll.body.updated >= 0);
  const cleared = await api.get('/v1/notifications?unread=true').set(auth(A.token));
  assert.equal(cleared.body.unreadCount, 0);

  const tokenOne = 'fcm-token-alpha-0000000000000001';
  const device = await api.post('/v1/me/push-devices').set(auth(A.token)).send({
    token: tokenOne, platform: 'android', clientDeviceId: 'device_alpha_1',
  });
  assert.equal(device.status, 201, JSON.stringify(device.body));
  assert.equal(device.body.registered, true);
  assert.equal(device.body.pushConfigured, false);
  const rotated = await api.post('/v1/me/push-devices').set(auth(A.token)).send({
    token: 'fcm-token-alpha-0000000000000002', platform: 'android', clientDeviceId: 'device_alpha_1',
  });
  assert.equal(rotated.status, 201);
  assert.equal(rotated.body.id, device.body.id);
  const removed = await api.delete(`/v1/me/push-devices/${device.body.id}`).set(auth(A.token));
  assert.equal(removed.body.removed, true);
});

test('social data deletion removes posts, albums, media, and returns object keys', async () => {
  const media = await uploadImage(api, A.token, 'delete_media_0001');
  const post = await api.post('/v1/posts').set(auth(A.token)).send({
    clientPostId: 'post_delete_0001', kind: 'photo', audience: 'public', mediaIds: [media.id],
  });
  assert.equal(post.status, 201, JSON.stringify(post.body));
  const albumMedia = await uploadImage(api, A.token, 'delete_album_media_0001', 'album_photo');
  const album = await api.post('/v1/albums').set(auth(A.token)).send({
    clientAlbumId: 'album_delete_0001', title: 'Album Hapus', visibility: 'private',
  });
  await api.post(`/v1/albums/${album.body.id}/media`).set(auth(A.token)).send({ mediaId: albumMedia.id });

  const purge = await api.delete('/v1/me/social-data').set(auth(A.token));
  assert.equal(purge.status, 200, JSON.stringify(purge.body));
  assert.equal(purge.body.deleted, true);
  assert.ok(purge.body.posts >= 1);
  assert.ok(purge.body.albums >= 1);
  assert.ok(purge.body.media >= 2);
  assert.ok(purge.body.objectKeys.length >= 2);

  assert.equal((await api.get(`/v1/posts/${post.body.id}`).set(auth(A.token))).status, 404);
  assert.equal((await api.get(`/v1/albums/${album.body.id}`).set(auth(A.token))).status, 404);
  assert.equal((await api.get(`/v1/media/${media.id}/url`).set(auth(A.token))).status, 404);
  assert.equal((await api.get('/v1/me/rider-profile').set(auth(A.token))).status, 200);
  const second = await api.delete('/v1/me/social-data').set(auth(A.token));
  assert.equal(second.status, 409);
  assert.equal(second.body.code, 'NOTHING_TO_DELETE');
});
