-- Phase 5: subscriptions, redeem, admin RBAC/audit, privacy jobs, and retention.
-- Prices are never stored here as amounts: Play Billing shows the localized price
-- and the backend only maps product ids to server-side entitlements.

CREATE TABLE plans (
  code text PRIMARY KEY,
  name varchar(40) NOT NULL,
  description varchar(200) NULL,
  active boolean NOT NULL DEFAULT false,
  billing_enabled boolean NOT NULL DEFAULT false,
  play_product_id varchar(120) NULL,
  trial_days integer NOT NULL DEFAULT 0 CHECK (trial_days >= 0),
  grace_days integer NOT NULL DEFAULT 3 CHECK (grace_days >= 0),
  limits jsonb NOT NULL DEFAULT '{}'::jsonb,
  features jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (code <> 'free' OR billing_enabled = false)
);

INSERT INTO plans (code, name, description, active, billing_enabled, limits, features) VALUES
  ('free', 'Free', 'Fitur keselamatan inti dan konvoi dasar.', true, false,
   '{"convoyCapacity": 3, "albumQuotaBytes": 209715200, "vehicleLimit": 3, "posterTemplates": ["first_light"]}',
   '{"safetyFeatures": true, "ads": true}'),
  ('pro', 'Pro', 'Kapasitas konvoi lebih besar dan album diperluas.', true, false,
   '{"convoyCapacity": 20, "albumQuotaBytes": 1073741824, "vehicleLimit": 10, "posterTemplates": ["first_light", "peloton_lines"]}',
   '{"safetyFeatures": true, "ads": false}'),
  ('pro_plus', 'Pro Plus', 'Kapasitas tertinggi dan seluruh template poster.', true, false,
   '{"convoyCapacity": 30, "albumQuotaBytes": 5368709120, "vehicleLimit": 20, "posterTemplates": ["first_light", "peloton_lines", "night_odometer"]}',
   '{"safetyFeatures": true, "ads": false}')
ON CONFLICT (code) DO NOTHING;

CREATE TABLE billing_products (
  product_id varchar(120) NOT NULL,
  base_plan_id varchar(120) NOT NULL,
  plan_code text NOT NULL REFERENCES plans(code) ON DELETE RESTRICT,
  active boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (product_id, base_plan_id)
);

CREATE TABLE subscriptions (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  plan_code text NOT NULL REFERENCES plans(code) ON DELETE RESTRICT,
  provider text NOT NULL DEFAULT 'google_play' CHECK (provider IN ('google_play', 'manual')),
  -- Hash is used for lookup; the sealed token exists only so reconciliation can
  -- re-check the provider without ever returning the raw token to a client.
  provider_subscription_id text NOT NULL,
  token_encrypted text NULL,
  product_id varchar(120) NOT NULL,
  base_plan_id varchar(120) NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN (
    'pending', 'active', 'in_grace', 'canceled', 'expired', 'paused', 'on_hold'
  )),
  auto_renew boolean NOT NULL DEFAULT true,
  started_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NULL,
  grace_until timestamptz NULL,
  last_verified_at timestamptz NULL,
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (provider, provider_subscription_id)
);
CREATE INDEX subscriptions_user_idx ON subscriptions (user_id, created_at DESC);
CREATE UNIQUE INDEX subscriptions_one_current ON subscriptions (user_id)
  WHERE status IN ('active', 'in_grace', 'canceled', 'paused', 'on_hold');

CREATE TABLE billing_purchases (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  product_id varchar(120) NOT NULL,
  subscription_id uuid NULL REFERENCES subscriptions(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('verified', 'rejected', 'duplicate')),
  raw jsonb NOT NULL DEFAULT '{}'::jsonb,
  verified_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE billing_notifications (
  message_id varchar(200) PRIMARY KEY,
  event_type varchar(60) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  processed_at timestamptz NULL,
  error varchar(300) NULL,
  received_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE billing_events (
  id uuid PRIMARY KEY,
  user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  subscription_id uuid NULL REFERENCES subscriptions(id) ON DELETE SET NULL,
  kind varchar(60) NOT NULL,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

-- Admin-issued grants (redeem subscription days, poster themes). They are
-- separate from provider subscriptions so a refund cannot erase a grant and a
-- grant cannot masquerade as a Play purchase.
CREATE TABLE user_grants (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('plan_days', 'poster_template')),
  value jsonb NOT NULL,
  source text NOT NULL DEFAULT 'redeem' CHECK (source IN ('redeem', 'admin')),
  expires_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX user_grants_user_idx ON user_grants (user_id, kind, expires_at);

CREATE TABLE redeem_codes (
  id uuid PRIMARY KEY,
  code_hash text NOT NULL UNIQUE,
  code_prefix varchar(8) NOT NULL,
  reward_kind text NOT NULL CHECK (reward_kind IN ('points', 'subscription_days', 'poster_template')),
  reward_value jsonb NOT NULL,
  quota_total integer NOT NULL CHECK (quota_total > 0),
  quota_used integer NOT NULL DEFAULT 0 CHECK (quota_used >= 0 AND quota_used <= quota_total),
  expires_at timestamptz NULL,
  active boolean NOT NULL DEFAULT true,
  created_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  CHECK (reward_kind <> 'subscription_days' OR reward_value ? 'planCode'),
  CHECK (reward_kind <> 'subscription_days' OR reward_value ? 'days'),
  CHECK (reward_kind <> 'poster_template' OR reward_value ? 'template'),
  CHECK (reward_kind <> 'points' OR reward_value ? 'points')
);

CREATE TABLE redeem_redemptions (
  id uuid PRIMARY KEY,
  code_id uuid NOT NULL REFERENCES redeem_codes(id) ON DELETE RESTRICT,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  idempotency_key varchar(80) NOT NULL,
  reward_kind text NOT NULL,
  reward_value jsonb NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (code_id, user_id),
  UNIQUE (user_id, idempotency_key)
);

CREATE TABLE admin_users (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('support', 'moderator', 'admin', 'superadmin')),
  mfa_secret_encrypted text NULL,
  mfa_enrolled_at timestamptz NULL,
  disabled boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE admin_audit_logs (
  id uuid PRIMARY KEY,
  actor_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  action varchar(80) NOT NULL,
  target_type varchar(40) NOT NULL,
  target_id uuid NULL,
  reason varchar(500) NOT NULL,
  before jsonb NULL,
  after jsonb NULL,
  request_id varchar(80) NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX admin_audit_actor_idx ON admin_audit_logs (actor_id, created_at DESC);
CREATE INDEX admin_audit_target_idx ON admin_audit_logs (target_type, target_id, created_at DESC);

CREATE TABLE admin_config (
  key varchar(80) PRIMARY KEY,
  value jsonb NOT NULL,
  updated_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  updated_at timestamptz NOT NULL DEFAULT now()
);
INSERT INTO admin_config (key, value) VALUES
  ('features', '{"billingEnabled": false, "paidFeaturesEnabled": false}'),
  ('app_version', '{"minimumVersion": "0.1.0", "latestVersion": "0.1.0", "forceUpdate": false}'),
  ('retention', '{"exportDays": 7, "deletionGraceDays": 30, "notificationDays": 180, "billingEventDays": 365}')
ON CONFLICT (key) DO NOTHING;

CREATE TABLE data_export_jobs (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'queued' CHECK (status IN ('queued', 'ready', 'failed', 'expired')),
  payload jsonb NULL,
  error varchar(300) NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  completed_at timestamptz NULL,
  expires_at timestamptz NULL
);
CREATE INDEX data_export_user_idx ON data_export_jobs (user_id, requested_at DESC);

CREATE TABLE data_deletion_requests (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'scheduled' CHECK (status IN ('scheduled', 'cancelled', 'completed')),
  reason varchar(300) NULL,
  requested_at timestamptz NOT NULL DEFAULT now(),
  execute_after timestamptz NOT NULL,
  completed_at timestamptz NULL
);
CREATE UNIQUE INDEX data_deletion_one_open ON data_deletion_requests (user_id)
  WHERE status = 'scheduled';

CREATE TABLE job_runs (
  id uuid PRIMARY KEY,
  job_name varchar(80) NOT NULL,
  status text NOT NULL CHECK (status IN ('running', 'succeeded', 'failed')),
  detail jsonb NOT NULL DEFAULT '{}'::jsonb,
  started_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz NULL
);

-- Community moderation and user-entitlement overrides.
ALTER TABLE communities ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'visible'
  CHECK (moderation_status IN ('visible', 'hidden', 'removed'));
ALTER TABLE communities ADD COLUMN IF NOT EXISTS moderated_at timestamptz NULL;
ALTER TABLE communities ADD COLUMN IF NOT EXISTS moderation_reason varchar(500) NULL;
ALTER TABLE user_entitlements ADD COLUMN IF NOT EXISTS extra jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS moderated_by uuid NULL REFERENCES users(id) ON DELETE SET NULL;
ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS moderated_at timestamptz NULL;
ALTER TABLE content_reports ADD COLUMN IF NOT EXISTS resolution_note varchar(500) NULL;

-- Redeem bonuses are admin-issued, never earned from riding behaviour.
ALTER TABLE point_ledger DROP CONSTRAINT IF EXISTS point_ledger_reason_check;
ALTER TABLE point_ledger ADD CONSTRAINT point_ledger_reason_check CHECK (reason IN (
  'safety_checklist', 'community_event_rsvp', 'effective_hazard_report', 'clean_comment', 'new_badge', 'redeem_bonus'
));
ALTER TABLE point_ledger DROP CONSTRAINT IF EXISTS point_ledger_reference_type_check;
ALTER TABLE point_ledger ADD CONSTRAINT point_ledger_reference_type_check CHECK (reference_type IN (
  'trip', 'community', 'hazard', 'comment', 'event', 'badge', 'redeem'
));
