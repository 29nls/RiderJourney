import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { PgDatabase } from '../db/database.js';
import { runMigrations } from '../db/migrate.js';

const enabled = process.env.POSTGRES_INTEGRATION === '1';
const skip = enabled ? false : 'POSTGRES_INTEGRATION not set (requires real PostgreSQL/PostGIS)';

let db: PgDatabase;

before(async () => {
  if (!enabled) return;
  const url = process.env.DATABASE_URL;
  assert.ok(url, 'DATABASE_URL is required for postgres integration');
  db = new PgDatabase(url, false);
  await runMigrations(db);
});

after(async () => {
  if (!enabled) return;
  await db.close();
});

test('migrations create schema_migrations and all 13 migration files are recorded', { skip }, async () => {
  const rows = await db.query<{ name: string }>('SELECT name FROM schema_migrations ORDER BY name');
  const names = rows.map((r) => r.name);
  assert.ok(names.length >= 13, `expected at least 13 migrations, got ${names.length}`);
  assert.ok(names.includes('0013_phase6_4.sql'), 'phase 6.4 migration must be applied');
});

test('PostGIS extension is installed and spatial types are available', { skip }, async () => {
  const ext = await db.query<{ extname: string }>(
    "SELECT extname FROM pg_extension WHERE extname = 'postgis'",
  );
  assert.equal(ext.length, 1, 'postgis extension must be installed');
  const typeCheck = await db.query<{ ok: boolean }>(
    "SELECT (to_regtype('geometry') IS NOT NULL AND to_regtype('geography') IS NOT NULL) AS ok",
  );
  assert.equal(typeCheck[0].ok, true, 'geometry and geography types must exist');
});

test('spatial columns and GiST index exist on routes', { skip }, async () => {
  const col = await db.query<{ data_type: string; udt_name: string }>(
    `SELECT data_type, udt_name FROM information_schema.columns
     WHERE table_name = 'routes' AND column_name = 'route_geometry'`,
  );
  assert.equal(col.length, 1, 'routes.route_geometry column must exist');
  const idx = await db.query<{ indexname: string }>(
    "SELECT indexname FROM pg_indexes WHERE tablename = 'routes' AND indexname = 'routes_geometry_idx'",
  );
  assert.equal(idx.length, 1, 'routes_geometry_idx must exist');
});

test('foreign keys are enforced', { skip }, async () => {
  await assert.rejects(
    async () => {
      await db.query(
        "INSERT INTO media_assets (id, owner_id, storage_key, bucket, content_type, byte_size, scan_status, created_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, 'unscanned', now(), now())",
        ['00000000-0000-0000-0000-000000000099', '00000000-0000-0000-0000-000000000000', 'k', 'b', 'image/jpeg', 1],
      );
    },
    /foreign key|violates/i,
    'media_assets.owner_user_id foreign key must be enforced',
  );
});

test('transaction rolls back on error', { skip }, async () => {
  await assert.rejects(
    async () => {
      await db.transaction(async (tx) => {
        await tx.query(
          "INSERT INTO schema_migrations (name) VALUES ($1)",
          ['__rollback_test__'],
        );
        throw new Error('force rollback');
      });
    },
    /force rollback/,
  );
  const rows = await db.query<{ name: string }>(
    "SELECT name FROM schema_migrations WHERE name = '__rollback_test__'",
  );
  assert.equal(rows.length, 0, 'rolled-back insert must not persist');
});

test('spatial query works on PostGIS', { skip }, async () => {
  const r = await db.query<{ d: number }>(
    "SELECT ST_Distance(ST_MakePoint(0,0)::geography, ST_MakePoint(1,1)::geography) AS d",
  );
  assert.ok(Number.isFinite(r[0].d), 'ST_Distance must return a finite number');
});
