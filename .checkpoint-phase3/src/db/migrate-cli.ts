import 'reflect-metadata';
import { loadConfig } from '../config/env.js';
import { PgDatabase } from './database.js';
import { runMigrations } from './migrate.js';

const config = loadConfig();
const db = new PgDatabase(config.databaseUrl, config.databaseSsl);
const command = process.argv[2] ?? 'up';

try {
  if (command === 'up') {
    const applied = await runMigrations(db);
    console.log(JSON.stringify({ ok: true, applied }));
  } else if (command === 'status') {
    await db.exec(`CREATE TABLE IF NOT EXISTS schema_migrations (name text PRIMARY KEY, applied_at timestamptz NOT NULL DEFAULT now())`);
    const rows = await db.query('SELECT name, applied_at FROM schema_migrations ORDER BY name');
    console.log(JSON.stringify({ ok: true, applied: rows }));
  } else {
    console.error('Usage: migration:run|migration:status');
    process.exitCode = 2;
  }
} finally {
  await db.close();
}
