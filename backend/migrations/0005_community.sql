-- Community extensions for the social phase. Members, events, RSVPs, channels,
-- and the audit table come from 0003_phase3.sql; this file adds only what is new.

-- Joining policy per community. A community without a row joins by request, so a
-- missing row never turns a private club open by accident.
CREATE TABLE community_policies (
  community_id uuid PRIMARY KEY REFERENCES communities(id) ON DELETE CASCADE,
  join_policy text NOT NULL DEFAULT 'request' CHECK (join_policy IN ('request', 'open')),
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Configurable role matrix. The owner role is absent on purpose: an owner always
-- holds every permission in the service, so no club can lock
-- itself out of management.
CREATE TABLE community_role_permissions (
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE CASCADE,
  role text NOT NULL CHECK (role IN ('admin', 'moderator', 'member')),
  permission text NOT NULL CHECK (permission IN (
    'post.create', 'post.remove_any', 'comment.remove_any',
    'member.approve', 'member.remove', 'member.ban', 'member.set_role',
    'event.publish', 'album.create', 'community.settings'
  )),
  granted_by uuid NULL REFERENCES users(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (community_id, role, permission)
);

-- At most one active owner per community, so ownership transfer is explicit and
-- a demote-then-promote sequence cannot leave two owners behind.
CREATE UNIQUE INDEX IF NOT EXISTS community_one_owner ON community_members (community_id)
  WHERE role = 'owner' AND status = 'active';

ALTER TABLE community_members ADD COLUMN IF NOT EXISTS role_changed_at timestamptz NULL;

-- Client-chosen ids keep "create event" and "RSVP" retries from duplicating rows.
ALTER TABLE community_events ADD COLUMN IF NOT EXISTS client_event_id varchar(80) NULL;
CREATE UNIQUE INDEX IF NOT EXISTS community_events_client_unique
  ON community_events (community_id, client_event_id);
ALTER TABLE community_event_rsvps ADD COLUMN IF NOT EXISTS client_id varchar(80) NULL;
ALTER TABLE community_event_rsvps ADD COLUMN IF NOT EXISTS reminder_at timestamptz NULL;

-- Capacity only counts current "going" rows; cancelled rows stay for audit and retries.
CREATE INDEX IF NOT EXISTS community_event_rsvps_going_idx
  ON community_event_rsvps (event_id) WHERE status = 'going';
