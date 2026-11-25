import 'reflect-metadata';
import { loadConfig } from '../config/env.js';
import { PgDatabase } from '../db/database.js';
import { PrivacyService } from './privacy.service.js';
import { RetentionService } from './retention.service.js';

const config = loadConfig();
const db = new PgDatabase(config.databaseUrl, config.databaseSsl);
const privacy = new PrivacyService(config, db);
const retention = new RetentionService(config, db, privacy);

try {
  console.log(JSON.stringify({ ok: true, result: await retention.run() }));
} catch (error) {
  console.error(JSON.stringify({ ok: false, error: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
} finally {
  await db.close();
}
