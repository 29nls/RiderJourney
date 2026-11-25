-- Phase 4 social extensions: reports, video media, soft delete, poster export,
-- push device identity, and the seeded badge catalogue.

-- Feed posts carry video, so the media catalogue must accept the two container
-- types the client records. Magic-byte checks still run at upload completion.
ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_mime_type_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_mime_type_check CHECK (mime_type IN (
  'image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm'
));

-- Images stay under 5 MiB; video gets a larger ceiling enforced by the service
-- per purpose. One database bound still keeps a bad row out of the table.
ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_size_bytes_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_size_bytes_check
  CHECK (size_bytes > 0 AND size_bytes <= 104857600);

ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS poster_id uuid NULL;

-- Phase 3 created content_reports for messages and hazards. Extend that table
-- rather than duplicating it, keeping its historical values valid.
ALTER TABLE content_reports DROP CONSTRAINT IF EXISTS content_reports_target_type_check;
ALTER TABLE content_reports ADD CONSTRAINT content_reports_target_type_check CHECK (target_type IN (
  'message', 'hazard', 'community_event', 'post', 'comment', 'user', 'album', 'media'
));
ALTER TABLE content_reports DROP CONSTRAINT IF EXISTS content_reports_reason_check;
ALTER TABLE content_reports ADD CONSTRAINT content_reports_reason_check CHECK (reason IN (
  'spam', 'harassment', 'false_safety', 'inappropriate', 'other', 'hate', 'sexual',
  'violence', 'self_harm', 'misinformation', 'dangerous_riding', 'impersonation'
));
ALTER TABLE content_reports DROP CONSTRAINT IF EXISTS content_reports_status_check;
ALTER TABLE content_reports ADD CONSTRAINT content_reports_status_check CHECK (status IN (
  'pending', 'reviewed', 'actioned', 'dismissed', 'open', 'reviewing'
));
ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS detail varchar(1000) NULL;
ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS client_report_id varchar(80) NULL;
ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS reviewed_at timestamptz NULL;
CREATE UNIQUE INDEX IF NOT EXISTS content_reports_client_unique
  ON content_reports (reporter_id, client_report_id) WHERE client_report_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS content_reports_status_idx ON content_reports (status, created_at DESC);

-- Album deletion is reversible, so quota and audit rows stay consistent until
-- the owner purges it.
ALTER TABLE albums ADD COLUMN IF NOT EXISTS deleted_at timestamptz NULL;
CREATE INDEX IF NOT EXISTS albums_live_idx ON albums (owner_id, created_at DESC)
  WHERE deleted_at IS NULL;

ALTER TABLE posters ADD COLUMN IF NOT EXISTS exported_at timestamptz NULL;
ALTER TABLE posters ADD COLUMN IF NOT EXISTS export_count integer NOT NULL DEFAULT 0
  CHECK (export_count >= 0);

-- A device is identified by the client's install id so re-registering the same
-- install rotates the token instead of creating a second row.
ALTER TABLE push_devices ADD COLUMN IF NOT EXISTS client_device_id varchar(80) NULL;
-- The raw token is needed to address FCM, so it is sealed with the contact key
-- while token_hash stays the unique lookup that never exposes the token.
ALTER TABLE push_devices ADD COLUMN IF NOT EXISTS token_encrypted text NULL;
CREATE UNIQUE INDEX IF NOT EXISTS push_devices_install_unique
  ON push_devices (user_id, client_device_id) WHERE client_device_id IS NOT NULL;

ALTER TABLE notifications ADD COLUMN IF NOT EXISTS pushed_at timestamptz NULL;

-- Seeded catalogue: every badge rewards preparation or community care, never
-- speed, distance, or phone use while moving.
INSERT INTO badges (code, title, description, criteria, for_safe_riding) VALUES
  ('pre_ride_check', 'Cek Sebelum Jalan', 'Menyelesaikan checklist keselamatan pra-berkendara.', '{"safetyChecklists": 1}', true),
  ('steady_ten', 'Sepuluh Kali Siap', 'Menyelesaikan checklist keselamatan sepuluh kali.', '{"safetyChecklists": 10}', true),
  ('hazard_spotter', 'Mata Jalan', 'Melaporkan bahaya jalan yang terverifikasi.', '{"effectiveHazardReports": 3}', true),
  ('community_voice', 'Suara Komunitas', 'Mengikuti kegiatan komunitas secara aktif.', '{"eventRsvps": 1}', true),
  ('kind_comment', 'Komentar Baik', 'Menulis komentar yang tidak dilaporkan.', '{"cleanComments": 5}', true)
ON CONFLICT (code) DO NOTHING;
