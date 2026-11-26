-- Phase 6.1: durable outbox for object-storage deletion.
-- A deleted database row cannot prove the bytes are gone, so every purge that
-- drops media metadata also enqueues the object key here, inside the same
-- transaction. The worker deletes the object and verifies it is absent.
CREATE TABLE IF NOT EXISTS media_deletion_outbox (
  id uuid PRIMARY KEY,
  object_key text NOT NULL,
  reason text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'processing', 'done', 'failed')),
  attempts integer NOT NULL DEFAULT 0 CHECK (attempts >= 0),
  next_attempt_at timestamptz NOT NULL DEFAULT now(),
  last_error text,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz
);

-- Object keys are never reused, so one row per key makes enqueueing idempotent.
CREATE UNIQUE INDEX IF NOT EXISTS media_deletion_outbox_key_unique ON media_deletion_outbox (object_key);
CREATE INDEX IF NOT EXISTS media_deletion_outbox_due_idx ON media_deletion_outbox (status, next_attempt_at);

-- Phase 3 hard-coded a 5 MB ceiling for every asset, so a video intent larger
-- than that failed at insert even though MEDIA_MAX_VIDEO_BYTES allows it. The
-- application still enforces a per-purpose limit; the table keeps the absolute
-- ceiling as a second line of defence.
ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_size_bytes_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_size_bytes_check CHECK (size_bytes > 0 AND size_bytes <= 104857600);
