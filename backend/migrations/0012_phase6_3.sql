-- Phase 6.3: media deletion, scan lifecycle, and reference lookup indexes.

-- 1. 'deleting' means the owner asked for deletion and the object is still in
--    storage. Quota keeps counting it until the worker proves it is gone.
ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_status_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_status_check
  CHECK (status IN ('pending', 'ready', 'rejected', 'deleted', 'deleting', 'expired'));

ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS deletion_requested_at timestamptz NULL;

-- 2. Scan lifecycle. 'scanning' is a lease state: a worker that dies mid-scan
--    leaves the row claimable again instead of stranding it.
ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_scan_status_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_scan_status_check
  CHECK (scan_status IN ('unscanned', 'scanning', 'clean', 'quarantined', 'scan_failed'));

ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS scan_attempts integer NOT NULL DEFAULT 0;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS scan_next_at timestamptz NULL;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS scan_last_error text NULL;

CREATE INDEX IF NOT EXISTS media_assets_scan_queue_idx
  ON media_assets (scan_next_at)
  WHERE status = 'ready' AND scan_status IN ('unscanned', 'scanning');

-- 3. Reference lookups run on every deletion request and every avatar/vehicle
--    photo replacement, so each referencing column gets an index.
CREATE INDEX IF NOT EXISTS rider_profiles_avatar_media_idx
  ON rider_profiles (avatar_media_id) WHERE avatar_media_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS users_avatar_media_idx
  ON users (avatar_media_id) WHERE avatar_media_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS vehicles_photo_media_idx
  ON vehicles (photo_media_id) WHERE photo_media_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS albums_cover_media_idx
  ON albums (cover_media_id) WHERE cover_media_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS hazard_reports_photo_media_idx
  ON hazard_reports (photo_media_id) WHERE photo_media_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS posters_media_idx
  ON posters (media_id) WHERE media_id IS NOT NULL;
