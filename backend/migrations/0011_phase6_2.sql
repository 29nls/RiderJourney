-- Phase 6.2: Storage Lifecycle & Android Media Integration.

-- 1. Add vehicle_photo purpose.
ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_purpose_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_purpose_check CHECK (purpose IN (
  'hazard_photo', 'community_asset', 'avatar', 'community_logo', 'community_cover',
  'post_photo', 'post_video', 'album_photo', 'album_video', 'poster', 'vehicle_photo'
));

-- 1b. Allow 'expired' for upload intents that lapsed before completion.
ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_status_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_status_check
  CHECK (status IN ('pending', 'ready', 'rejected', 'deleted', 'expired'));

-- 2. Media scanning status (quarantine support).
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS scan_status text NOT NULL DEFAULT 'unscanned'
  CHECK (scan_status IN ('unscanned', 'clean', 'quarantined', 'scan_failed'));
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS scanned_at timestamptz NULL;

-- 3. Link users and vehicles to media assets.
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_media_id uuid NULL;
ALTER TABLE vehicles ADD COLUMN IF NOT EXISTS photo_media_id uuid NULL;

-- 4. Per-user storage quota tracking.
CREATE TABLE IF NOT EXISTS storage_quotas (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  quota_bytes bigint NOT NULL DEFAULT 209715200, -- 200 MB default
  used_bytes bigint NOT NULL DEFAULT 0 CHECK (used_bytes >= 0),
  reserved_bytes bigint NOT NULL DEFAULT 0 CHECK (reserved_bytes >= 0),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Index for expired upload cleanup.
CREATE INDEX IF NOT EXISTS media_assets_expired_pending_idx
  ON media_assets (upload_expires_at)
  WHERE status = 'pending' AND upload_expires_at IS NOT NULL;
