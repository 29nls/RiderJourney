import { after, before, test } from 'node:test';
import assert from 'node:assert/strict';
import { PGliteDatabase } from './pglite.database.js';
import { runMigrations } from '../db/migrate.js';

let db: PGliteDatabase;

before(async () => {
  process.env.NODE_ENV = 'test';
  db = await PGliteDatabase.create();
});

after(async () => {
  await db.close();
});

test('phase 4 migrations apply in order on PostgreSQL with PostGIS', async () => {
  const applied = await runMigrations(db);
  assert.deepEqual(applied, ['0001_init.sql', '0002_convoys.sql', '0003_phase3.sql', '0004_phase4.sql', '0005_community.sql', '0006_phase4_social.sql', '0007_phase5.sql', '0008_phase1.sql']);
  const tables = await db.query<{ table_name: string }>(
    `SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`,
  );
  const names = tables.map((row) => row.table_name);
  for (const table of [
    'rider_profiles', 'follows', 'user_blocks', 'user_mutes', 'follow_requests',
    'posts', 'post_media', 'reactions', 'comments', 'comment_reactions', 'post_saves',
    'albums', 'trip_segments', 'trip_photos', 'trip_reactions', 'hashtags', 'mentions',
    'notifications', 'notification_preferences', 'push_devices', 'point_ledger',
    'user_badges', 'posters', 'content_reports', 'community_policies', 'community_role_permissions',
    'community_members', 'community_events', 'community_event_rsvps', 'community_audit_logs',
  ]) {
    assert.ok(names.includes(table), `${table} should exist`);
  }
});
