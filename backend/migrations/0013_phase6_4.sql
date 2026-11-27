-- Phase 6.4: moderation workflow, operational alerts, deletion recovery audit.

-- ---------------------------------------------------------------------------
-- 1. Content moderation (separate from malware scanning)
-- ---------------------------------------------------------------------------
-- Scan state answers "is this file dangerous"; moderation answers "does this
-- content break community rules". They never share a column.
ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_moderation_status_check;
UPDATE media_assets SET moderation_status = 'pending_review' WHERE moderation_status = 'pending';
ALTER TABLE media_assets ALTER COLUMN moderation_status SET DEFAULT 'pending_review';
ALTER TABLE media_assets ADD CONSTRAINT media_assets_moderation_status_check
  CHECK (moderation_status IN ('not_required', 'pending_review', 'approved', 'rejected', 'hidden'));

ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS moderation_reason text NULL;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS moderation_requested_at timestamptz NULL;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS moderation_reviewed_at timestamptz NULL;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS moderation_reviewer_id uuid NULL
  REFERENCES users(id) ON DELETE SET NULL;

CREATE TABLE IF NOT EXISTS media_moderation_log (
  id uuid PRIMARY KEY,
  media_id uuid NOT NULL,
  actor_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('request', 'approve', 'reject', 'hide', 'reopen')),
  from_status text NULL,
  to_status text NOT NULL,
  reason text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_moderation_log_media_idx
  ON media_moderation_log (media_id, created_at DESC);

CREATE INDEX IF NOT EXISTS media_assets_moderation_queue_idx
  ON media_assets (moderation_requested_at)
  WHERE moderation_status = 'pending_review';

-- ---------------------------------------------------------------------------
-- 2. Operational alerts
-- ---------------------------------------------------------------------------
-- One row per alert kind: a repeated condition bumps occurrences instead of
-- creating a new row, which is what makes deduplication and cooldown possible
-- without an external metrics system.
CREATE TABLE IF NOT EXISTS ops_alert_events (
  id uuid PRIMARY KEY,
  kind text NOT NULL UNIQUE,
  severity text NOT NULL CHECK (severity IN ('warning', 'critical')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'resolved')),
  summary text NOT NULL,
  details jsonb NOT NULL DEFAULT '{}'::jsonb,
  occurrences integer NOT NULL DEFAULT 1,
  first_seen_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now(),
  last_notified_at timestamptz NULL,
  resolved_at timestamptz NULL
);
CREATE INDEX IF NOT EXISTS ops_alert_events_status_idx ON ops_alert_events (status, last_seen_at DESC);

-- ---------------------------------------------------------------------------
-- 3. Deletion recovery audit
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS media_deletion_ops_log (
  id uuid PRIMARY KEY,
  outbox_id uuid NOT NULL,
  actor_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL CHECK (action IN ('requeue', 'cancel', 'reconcile')),
  note text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS media_deletion_ops_log_outbox_idx
  ON media_deletion_ops_log (outbox_id, created_at DESC);

-- Stale-deletion scanning looks for rows that have sat in 'deleting' too long.
CREATE INDEX IF NOT EXISTS media_assets_deleting_idx
  ON media_assets (deletion_requested_at) WHERE status = 'deleting';
