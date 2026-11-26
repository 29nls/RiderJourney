import 'reflect-metadata';
import { loadConfig } from '../config/env.js';
import { PgDatabase } from '../db/database.js';
import { MediaDeletionWorker } from '../media/deletion-outbox.js';
import { createObjectStorage } from '../media/object-storage.js';

const config = loadConfig();
const db = new PgDatabase(config.databaseUrl, config.databaseSsl);
const worker = new MediaDeletionWorker(config, db, createObjectStorage(config));

try {
  const status = await worker.status();
  const result = process.argv.includes('--run') ? await worker.processBatch(100) : null;
  console.log(JSON.stringify({ ok: true, status, result }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
} finally {
  await db.close();
}
