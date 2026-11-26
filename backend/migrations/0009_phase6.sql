-- Phase 6: account-scoped login throttling.
-- Keyed by a hash of the normalised email so a leaked dump of this table does not
-- hand out a ready-made list of account addresses. Global limits are per IP and
-- cannot stop credential stuffing across many addresses, nor a distributed attack
-- on one account, which is what this table exists for.
CREATE TABLE IF NOT EXISTS login_throttles (
  email_hash text PRIMARY KEY,
  failed_count integer NOT NULL DEFAULT 0,
  window_started_at timestamptz NOT NULL DEFAULT now(),
  locked_until timestamptz,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS login_throttles_locked_idx ON login_throttles (locked_until);
