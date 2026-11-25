-- Phase 3: convoy chat, hazard reports, private emergency contacts, communities.

-- Colours and lines are fixed per convoy so a rider cannot spoof or restyle
-- safety warnings; the client only renders what the server picked here.
CREATE TABLE convoy_chat_settings (
  convoy_id uuid PRIMARY KEY REFERENCES convoys(id) ON DELETE CASCADE,
  my_color text NOT NULL DEFAULT 'yellow' CHECK (my_color IN ('yellow', 'blue', 'orange', 'pink', 'purple', 'green')),
  my_line_style text NOT NULL DEFAULT 'dashed' CHECK (my_line_style IN ('dashed', 'solid', 'dotted')),
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE convoy_messages (
  id uuid PRIMARY KEY,
  convoy_id uuid NOT NULL REFERENCES convoys(id) ON DELETE CASCADE,
  sender_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_message_id varchar(80) NOT NULL,
  kind text NOT NULL CHECK (kind IN ('text', 'location', 'waypoint')),
  body varchar(2000) NULL,
  location geography(Point, 4326) NULL,
  label varchar(120) NULL,
  moderation_status text NOT NULL DEFAULT 'visible' CHECK (moderation_status IN ('visible', 'hidden', 'removed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  UNIQUE (convoy_id, sender_id, client_message_id),
  CHECK (
    (kind = 'text' AND body IS NOT NULL AND location IS NULL) OR
    (kind IN ('location', 'waypoint') AND location IS NOT NULL AND body IS NULL)
  )
);
CREATE INDEX convoy_messages_page_idx ON convoy_messages (convoy_id, created_at DESC, id DESC);
CREATE INDEX convoy_messages_sender_idx ON convoy_messages (sender_id, created_at DESC);

CREATE TABLE content_reports (
  id uuid PRIMARY KEY,
  reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_type text NOT NULL CHECK (target_type IN ('message', 'hazard', 'community_event')),
  target_id uuid NOT NULL,
  reason text NOT NULL CHECK (reason IN ('spam', 'harassment', 'false_safety', 'inappropriate', 'other')),
  note varchar(500) NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'reviewed', 'actioned', 'dismissed')),
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (reporter_id, target_type, target_id)
);
CREATE INDEX content_reports_target_idx ON content_reports (target_type, target_id, created_at DESC);

CREATE TABLE user_blocks (
  blocker_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  blocked_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX user_blocks_blocked_idx ON user_blocks (blocked_id);

ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS upload_expires_at timestamptz NULL;

CREATE TABLE community_channels (
  id uuid PRIMARY KEY,
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  slug varchar(40) NOT NULL,
  name varchar(80) NOT NULL,
  type text NOT NULL CHECK (type IN ('text', 'voice')),
  visibility text NOT NULL DEFAULT 'members' CHECK (visibility IN ('members', 'public')),
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX community_channels_slug_unique ON community_channels (community_id, lower(slug));

CREATE TABLE media_assets (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  purpose text NOT NULL CHECK (purpose IN ('hazard_photo', 'community_asset', 'avatar', 'community_logo', 'community_cover')),
  mime_type text NOT NULL CHECK (mime_type IN ('image/jpeg', 'image/png', 'image/webp')),
  size_bytes integer NOT NULL CHECK (size_bytes > 0 AND size_bytes <= 5242880),
  object_key text NOT NULL,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'ready', 'rejected', 'deleted')),
  created_at timestamptz NOT NULL DEFAULT now(),
  ready_at timestamptz NULL
);
CREATE INDEX media_assets_owner_idx ON media_assets (owner_id, created_at DESC);

CREATE TABLE hazard_reports (
  id uuid PRIMARY KEY,
  reporter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('road_damage', 'accident', 'congestion', 'police', 'weather', 'obstacle', 'other')),
  location geography(Point, 4326) NOT NULL,
  note varchar(500) NULL,
  photo_media_id uuid NULL REFERENCES media_assets(id) ON DELETE SET NULL,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'expired', 'removed')),
  moderation_status text NOT NULL DEFAULT 'visible' CHECK (moderation_status IN ('visible', 'hidden', 'removed')),
  expires_at timestamptz NOT NULL,
  still_present_count integer NOT NULL DEFAULT 0 CHECK (still_present_count >= 0),
  not_relevant_count integer NOT NULL DEFAULT 0 CHECK (not_relevant_count >= 0),
  last_confirmed_at timestamptz NULL,
  duplicate_of_id uuid NULL REFERENCES hazard_reports(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX hazard_reports_nearby_idx ON hazard_reports USING GIST (location);
CREATE INDEX hazard_reports_active_idx ON hazard_reports (status, expires_at);

CREATE TABLE hazard_confirmations (
  hazard_id uuid NOT NULL REFERENCES hazard_reports(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  verdict text NOT NULL CHECK (verdict IN ('still_present', 'not_relevant')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (hazard_id, user_id)
);

CREATE TABLE emergency_contacts (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name_ciphertext bytea NOT NULL,
  name_iv bytea NOT NULL,
  name_tag bytea NOT NULL,
  phone_ciphertext bytea NOT NULL,
  phone_iv bytea NOT NULL,
  phone_tag bytea NOT NULL,
  relationship varchar(40) NULL,
  is_primary boolean NOT NULL DEFAULT false,
  key_version smallint NOT NULL DEFAULT 1,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX emergency_contacts_user_idx ON emergency_contacts (user_id, created_at);

CREATE TABLE communities (
  id uuid PRIMARY KEY,
  slug varchar(40) NOT NULL,
  name varchar(80) NOT NULL,
  description varchar(2000) NULL,
  logo_url text NULL,
  cover_url text NULL,
  region varchar(120) NULL,
  rules varchar(5000) NULL,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'private')),
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX communities_slug_unique ON communities (lower(slug));

CREATE TABLE community_members (
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role text NOT NULL DEFAULT 'member' CHECK (role IN ('owner', 'admin', 'moderator', 'member')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'requested', 'left', 'removed', 'banned')),
  joined_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, user_id)
);
CREATE INDEX community_members_user_idx ON community_members (user_id, status);
CREATE INDEX community_members_community_idx ON community_members (community_id, status);

CREATE TABLE community_events (
  id uuid PRIMARY KEY,
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  created_by uuid NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
  title varchar(120) NOT NULL,
  description varchar(2000) NULL,
  starts_at timestamptz NOT NULL,
  meeting_point geography(Point, 4326) NOT NULL,
  capacity smallint NOT NULL CHECK (capacity BETWEEN 2 AND 1000),
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('draft', 'published', 'cancelled', 'completed')),
  version integer NOT NULL DEFAULT 1 CHECK (version >= 1),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX community_events_community_idx ON community_events (community_id, starts_at);
CREATE INDEX community_events_status_idx ON community_events (status, starts_at);

CREATE TABLE community_event_rsvps (
  event_id uuid NOT NULL REFERENCES community_events(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'going' CHECK (status IN ('going', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (event_id, user_id)
);

-- Channels that opt into `private` are visible to active members only; the other
-- channels are listed publicly so people can see what a club talks about.
ALTER TABLE community_channels ADD COLUMN IF NOT EXISTS is_private boolean NOT NULL DEFAULT false;

-- RSVP count and capacity check need a fast lookup by event and status.
CREATE INDEX IF NOT EXISTS community_event_rsvps_event_idx ON community_event_rsvps (event_id, status);

CREATE TABLE community_audit_logs (
  id uuid PRIMARY KEY,
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  actor_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  action text NOT NULL,
  target_user_id uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX community_audit_community_idx ON community_audit_logs (community_id, created_at DESC);
