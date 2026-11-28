import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import net from 'node:net';
import { randomBytes } from 'node:crypto';
import request from 'supertest';
import type { INestApplication } from '@nestjs/common';
import { PGliteDatabase } from './pglite.database.js';
import { runMigrations } from '../db/migrate.js';
import { buildTestApp } from './app.factory.js';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { ClamAvMediaScanner } from '../media/media-scanner.js';
import { MediaScanWorker } from '../media/scan-worker.js';
import type { ObjectStream } from '../media/object-storage.js';
import { testStorage } from './fake-storage.js';
import { auth, registerUser, uploadImage, type TestApi } from './phase4.helpers.js';

/**
 * Real clamd integration. These tests are skipped unless CLAMAV_INTEGRATION=1
 * and a daemon answers on CLAMAV_HOST:CLAMAV_PORT. Nothing here is mocked into
 * "clean": the EICAR file must be detected by the daemon's own signature set.
 *
 * EICAR is the industry-standard *harmless* antivirus test string. No live
 * malware is used anywhere in this project.
 */

const enabled = process.env.CLAMAV_INTEGRATION === '1';
const HOST = process.env.CLAMAV_HOST ?? '127.0.0.1';
const PORT = Number(process.env.CLAMAV_PORT ?? 3310);
const TIMEOUT_MS = Number(process.env.CLAMAV_TIMEOUT_MS ?? 30000);
const skip = enabled ? false : 'CLAMAV_INTEGRATION not set (start clamd and re-run with CLAMAV_INTEGRATION=1)';

// Split so the literal never appears whole in a source scan that flags EICAR.
const EICAR = [
  'X5O!P%@AP[4\\PZX54(P^)7CC)7}$EICAR-STANDARD-ANTIVIRUS-TEST-FILE!$H+H*',
].join('');

let db: PGliteDatabase;
let app: INestApplication;
let api: TestApi;
let config: AppConfig;
let owner: { token: string; id: string };
let other: { token: string; id: string };

function streamOf(body: Buffer): () => Promise<ObjectStream> {
  return async () => ({
    contentLength: body.length,
    stream: (async function* () {
      yield body;
    })(),
  });
}

/** Single-chunk and multi-chunk writers behave differently on the wire. */
async function scanBody(scanner: ClamAvMediaScanner, body: Buffer) {
  return scanner.scan('test/key.bin', 'application/octet-stream', streamOf(body));
}

/** Tracks connections so close() cannot wait forever on a half-open socket. */
function closer(server: net.Server) {
  const sockets = new Set<net.Socket>();
  server.on('connection', (socket) => {
    sockets.add(socket);
    socket.on('close', () => sockets.delete(socket));
  });
  return () =>
    new Promise<void>((resolve) => {
      for (const socket of sockets) socket.destroy();
      server.close(() => resolve());
    });
}

async function startSilentServer(): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer(() => {
    /* accept and never answer */
  });
  const close = closer(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  return { port, close };
}

async function startFixedReplyServer(reply: string): Promise<{ port: number; close: () => Promise<void> }> {
  const server = net.createServer((socket) => {
    socket.once('data', () => socket.end(`${reply}\0`));
  });
  const close = closer(server);
  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const { port } = server.address() as net.AddressInfo;
  return { port, close };
}

before(async () => {
  if (!enabled) return;
  process.env.NODE_ENV = 'test';
  process.env.PLATE_ENCRYPTION_KEY = Buffer.alloc(32, 53).toString('base64');
  process.env.MEDIA_S3_BUCKET = 'test-bucket';
  process.env.MEDIA_S3_ACCESS_KEY = 'test-access';
  process.env.MEDIA_S3_SECRET_KEY = 'test-secret';
  process.env.MEDIA_QUOTA_BYTES_DEFAULT = '25000000';
  process.env.MEDIA_SCAN_MAX_ATTEMPTS = '2';
  process.env.MEDIA_SCAN_RETRY_SECONDS = '0';

  db = await PGliteDatabase.create();
  await runMigrations(db);
  const built = await buildTestApp(db);
  app = built.app;
  config = app.get<AppConfig>(APP_CONFIG);
  api = request(app.getHttpServer() as Parameters<typeof request>[0]);
  owner = await registerUser(api, 'clamav_owner', 'Clam Owner');
  other = await registerUser(api, 'clamav_other', 'Clam Other');
});

after(async () => {
  if (!enabled) return;
  await app.close();
  await db.close();
});

test('a clean file is reported clean by the real daemon', { skip }, async () => {
  const scanner = new ClamAvMediaScanner({ host: HOST, port: PORT, timeoutMs: TIMEOUT_MS });
  const result = await scanBody(scanner, randomBytes(64 * 1024));
  assert.equal(result.status, 'clean', JSON.stringify(result));
  assert.equal(result.provider, 'clamav');
});

test('the EICAR test file is detected and never reported clean', { skip }, async () => {
  const scanner = new ClamAvMediaScanner({ host: HOST, port: PORT, timeoutMs: TIMEOUT_MS });
  const result = await scanBody(scanner, Buffer.from(`${EICAR}\n`));
  assert.equal(result.status, 'quarantined', JSON.stringify(result));
  assert.match(result.details ?? '', /eicar/i);
});

test('INSTREAM framing carries a multi-chunk payload', { skip }, async () => {
  const scanner = new ClamAvMediaScanner({ host: HOST, port: PORT, timeoutMs: TIMEOUT_MS });
  let opens = 0;
  const result = await scanner.scan('test/chunked.bin', 'image/jpeg', async () => {
    opens += 1;
    return {
      contentLength: 512 * 1024,
      stream: (async function* () {
        for (let i = 0; i < 8; i += 1) yield randomBytes(64 * 1024);
      })(),
    };
  });
  assert.equal(opens, 1);
  assert.equal(result.status, 'clean', JSON.stringify(result));
});

test('an unreachable daemon is a failure, never clean', async () => {
  const server = await startSilentServer();
  await server.close();
  const scanner = new ClamAvMediaScanner({ host: '127.0.0.1', port: server.port, timeoutMs: 1000 });
  const result = await scanBody(scanner, Buffer.from('hello'));
  assert.equal(result.status, 'scan_failed');
});

test('a daemon that never answers times out as a failure', async () => {
  const server = await startSilentServer();
  try {
    const scanner = new ClamAvMediaScanner({ host: '127.0.0.1', port: server.port, timeoutMs: 300 });
    const result = await scanBody(scanner, Buffer.from('hello'));
    assert.equal(result.status, 'scan_failed');
    assert.match(result.details ?? '', /timeout/i);
  } finally {
    await server.close();
  }
});

test('a size-limit error from clamd is a failure, not clean', async () => {
  const server = await startFixedReplyServer('INSTREAM size limit exceeded. ERROR');
  try {
    const scanner = new ClamAvMediaScanner({ host: '127.0.0.1', port: server.port, timeoutMs: 2000 });
    const result = await scanBody(scanner, randomBytes(1024));
    assert.equal(result.status, 'scan_failed');
  } finally {
    await server.close();
  }
});

test('an unexpected daemon reply is a failure, not clean', async () => {
  const server = await startFixedReplyServer('something unexpected');
  try {
    const scanner = new ClamAvMediaScanner({ host: '127.0.0.1', port: server.port, timeoutMs: 2000 });
    const result = await scanBody(scanner, randomBytes(1024));
    assert.equal(result.status, 'scan_failed');
    assert.match(result.details ?? '', /unexpected/i);
  } finally {
    await server.close();
  }
});

test('the worker quarantines EICAR in storage and keeps it from other users', { skip }, async () => {
  const uploaded = await uploadImage(api, owner.token, `clamav_eicar_${Date.now()}`, 'avatar');
  const key = new URL(uploaded.uploadUrl).pathname.replace(/^\//, '');
  testStorage.put(key, Buffer.from(`${EICAR}\n`), 'image/jpeg');

  const scanner = new ClamAvMediaScanner({ host: HOST, port: PORT, timeoutMs: TIMEOUT_MS });
  const worker = new MediaScanWorker(config, db, testStorage, scanner);
  const batch = await worker.scanBatch(10);
  assert.ok(batch.quarantined >= 1, JSON.stringify(batch));

  const row = await db.query<{ scan_status: string; scan_last_error: string | null }>(
    `SELECT scan_status, scan_last_error FROM media_assets WHERE id = $1`,
    [uploaded.id],
  );
  assert.equal(row[0].scan_status, 'quarantined');
  assert.match(row[0].scan_last_error ?? '', /eicar/i, 'the signature is persisted for operators');

  const foreign = await api.get(`/v1/media/${uploaded.id}/url`).set(auth(other.token));
  assert.equal(foreign.status, 404, 'quarantined media is never served to other users');
});

test('a failed scan retries and only becomes clean when the daemon proves it', { skip }, async () => {
  const uploaded = await uploadImage(api, owner.token, `clamav_retry_${Date.now()}`, 'avatar');
  const key = new URL(uploaded.uploadUrl).pathname.replace(/^\//, '');
  testStorage.put(key, randomBytes(2048), 'image/jpeg');

  const dead = new ClamAvMediaScanner({ host: '127.0.0.1', port: 1, timeoutMs: 300 });
  const failing = new MediaScanWorker(config, db, testStorage, dead);
  await failing.scanBatch(10);

  let row = await db.query<{ scan_status: string; scan_attempts: number }>(
    `SELECT scan_status, scan_attempts FROM media_assets WHERE id = $1`,
    [uploaded.id],
  );
  assert.equal(row[0].scan_status, 'unscanned');
  assert.ok(row[0].scan_attempts >= 1);

  await db.query(`UPDATE media_assets SET scan_next_at = now() - interval '1 second' WHERE id = $1`, [uploaded.id]);
  const live = new MediaScanWorker(config, db, testStorage, new ClamAvMediaScanner({ host: HOST, port: PORT, timeoutMs: TIMEOUT_MS }));
  await live.scanBatch(10);

  const finalRow = await db.query<{ scan_status: string }>(
    `SELECT scan_status FROM media_assets WHERE id = $1`,
    [uploaded.id],
  );
  assert.equal(finalRow[0].scan_status, 'clean');
});

test('a worker killed mid-scan leaves a reclaimable lease', { skip }, async () => {
  const uploaded = await uploadImage(api, owner.token, `clamav_lease_${Date.now()}`, 'avatar');
  const key = new URL(uploaded.uploadUrl).pathname.replace(/^\//, '');
  testStorage.put(key, randomBytes(2048), 'image/jpeg');

  await db.query(
    `UPDATE media_assets SET scan_status = 'scanning', scan_next_at = now() - interval '10 minutes' WHERE id = $1`,
    [uploaded.id],
  );

  const worker = new MediaScanWorker(config, db, testStorage, new ClamAvMediaScanner({ host: HOST, port: PORT, timeoutMs: TIMEOUT_MS }));
  const batch = await worker.scanBatch(10);
  assert.ok(batch.scanned >= 1, 'an expired lease is reclaimed instead of stranding the row');

  const row = await db.query<{ scan_status: string }>(`SELECT scan_status FROM media_assets WHERE id = $1`, [uploaded.id]);
  assert.equal(row[0].scan_status, 'clean');
});
