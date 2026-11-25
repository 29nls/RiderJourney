-- Phase 2: convoy membership, invitations, entitlements, and audit.
CREATE TABLE user_entitlements (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  plan_code text NOT NULL DEFAULT 'free',
  convoy_capacity smallint NOT NULL CHECK (convoy_capacity BETWEEN 1 AND 100),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE convoys (
  id uuid PRIMARY KEY,
  leader_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  name varchar(80) NOT NULL,
  meeting_point geography(Point, 4326) NOT NULL,
  destination geography(Point, 4326) NOT NULL,
  waypoints jsonb NOT NULL DEFAULT '[]'::jsonb,
  scheduled_at timestamptz NULL,
  capacity smallint NOT NULL CHECK (capacity BETWEEN 2 AND 100),
  status text NOT NULL DEFAULT 'lobby' CHECK (status IN ('draft', 'lobby', 'active', 'paused', 'completed', 'cancelled')),
  route_id uuid NULL REFERENCES routes(id) ON DELETE SET NULL,
  route_version integer NOT NULL DEFAULT 0 CHECK (route_version >= 0),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  started_at timestamptz NULL,
  paused_at timestamptz NULL,
  completed_at timestamptz NULL,
  cancelled_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX convoys_leader_idx ON convoys (leader_id, created_at DESC);
CREATE INDEX convoys_status_idx ON convoys (status) WHERE status IN ('lobby', 'active', 'paused');

CREATE TABLE convoy_members (
  convoy_id uuid NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('leader', 'co_leader', 'member')),
  status text NOT NULL DEFAULT 'requested' CHECK (status IN ('active', 'requested', 'left', 'removed')),
  sharing_consent boolean NOT NULL DEFAULT false,
  invited_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  joined_at timestamptz NULL,
  last_seen_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (convoy_id, user_id)
);
CREATE UNIQUE INDEX convoy_one_open_membership ON convoy_members (user_id) WHERE status IN ('active', 'requested');
CREATE INDEX convoy_members_convoy_idx ON convoy_members (convoy_id, status);

CREATE TABLE convoy_invites (
  id uuid PRIMARY KEY,
  convoy_id uuid NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  code_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  max_uses smallint NOT NULL CHECK (max_uses BETWEEN 1 AND 100),
  used_count smallint NOT NULL DEFAULT 0 CHECK (used_count >= 0),
  revoked_at timestamptz NULL,
  revoked_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX convoy_invites_convoy_idx ON convoy_invites (convoy_id, created_at DESC);

CREATE TABLE convoy_audit_logs (
  id uuid PRIMARY KEY,
  convoy_id uuid NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
  actor_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  request_id text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX convoy_audit_convoy_idx ON convoy_audit_logs (convoy_id, created_at DESC);
