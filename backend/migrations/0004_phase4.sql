-- Phase 4: trip replay, social feed, albums, posters, engagement, notifications.
-- Object storage keeps the bytes; every table here keeps only metadata and keys.

-- ---------------------------------------------------------------------------
-- Social graph and privacy controls
-- ---------------------------------------------------------------------------

CREATE TABLE rider_profiles (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  headline varchar(120) NULL,
  home_region varchar(120) NULL,
  bio varchar(500) NULL,
  avatar_media_id uuid NULL,
  cover_media_id uuid NULL,
  feed_visibility text NOT NULL DEFAULT 'followers' CHECK (feed_visibility IN ('public', 'followers', 'community', 'private')),
  leaderboard_opt_in boolean NOT NULL DEFAULT false,
  updated_at timestamptz NOT NULL DEFAULT now()
);

-- Follow, block, and mute share one shape: an actor and a subject, unique per pair.
-- Expired follow requests and one-sided blocks are still rows, so revocation stays idempotent.
CREATE TABLE follows (
  follower_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  followee_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX follows_followee_idx ON follows (followee_id, created_at DESC);

CREATE TABLE user_mutes (
  muter_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  muted_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (muter_id, muted_id),
  CHECK (muter_id <> muted_id)
);

CREATE TABLE follow_requests (
  requester_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  target_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'accepted', 'declined', 'cancelled')),
  created_at timestamptz NOT NULL DEFAULT now(),
  responded_at timestamptz NULL,
  PRIMARY KEY (requester_id, target_id),
  CHECK (requester_id <> target_id)
);
CREATE INDEX follow_requests_target_idx ON follow_requests (target_id, status);

-- ---------------------------------------------------------------------------
-- Media: one row per object, uploaded by signed URL, verified before `ready`.
-- Reuses Phase 3 media_assets (owner_id, purpose, object_key, status).
-- ---------------------------------------------------------------------------

ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS client_media_id varchar(80) NULL;

ALTER TABLE media_assets DROP CONSTRAINT IF EXISTS media_assets_purpose_check;
ALTER TABLE media_assets ADD CONSTRAINT media_assets_purpose_check CHECK (purpose IN (
  'hazard_photo', 'community_asset', 'avatar', 'community_logo', 'community_cover',
  'post_photo', 'post_video', 'album_photo', 'album_video', 'poster'
));

ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS album_id uuid NULL;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS post_id uuid NULL;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS width integer NULL;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS height integer NULL;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS duration_s integer NULL;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS taken_at timestamptz NULL;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS caption varchar(300) NULL;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS sort_index integer NOT NULL DEFAULT 0;
ALTER TABLE media_assets ADD COLUMN IF NOT EXISTS moderation_status text NOT NULL DEFAULT 'pending'
  CHECK (moderation_status IN ('pending', 'approved', 'rejected'));
-- Signed GET/PUT URLs are minted per request with a short TTL; nothing is stored.

CREATE INDEX IF NOT EXISTS media_assets_album_idx ON media_assets (album_id, sort_index);
CREATE INDEX IF NOT EXISTS media_assets_post_idx ON media_assets (post_id);

-- ---------------------------------------------------------------------------
-- Trips: replay data derived from trip_points (never from client claims).
-- ---------------------------------------------------------------------------

ALTER TABLE trips ADD COLUMN IF NOT EXISTS summary jsonb NOT NULL DEFAULT '{}'::jsonb;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS replay_version integer NOT NULL DEFAULT 0;
ALTER TABLE trips ADD COLUMN IF NOT EXISTS shared_with uuid[] NOT NULL DEFAULT '{}';

-- Segment table gives replay and poster a stable payload that survives point
-- pruning: one row per continuous run of accepted points, with holes modelled as gaps.
CREATE TABLE trip_segments (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  seq integer NOT NULL,
  distance_m integer NOT NULL DEFAULT 0,
  duration_s integer NOT NULL DEFAULT 0,
  started_at timestamptz NOT NULL,
  ended_at timestamptz NOT NULL,
  point_geom geometry(LineString, 4326) NOT NULL,
  gap_before_s integer NOT NULL DEFAULT 0,
  noisy_points integer NOT NULL DEFAULT 0,
  UNIQUE (trip_id, seq)
);
CREATE INDEX trip_segments_trip_idx ON trip_segments (trip_id, seq);
CREATE INDEX trip_segments_geom_idx ON trip_segments USING gist (point_geom);

-- A mapping from (kind, reference) to a monotonically increasing ordinal so
-- reactions, comments and re-sends can be appended in order without a sequence.
CREATE TABLE trip_ordinals (
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('reaction', 'comment', 'photo')),
  next_value integer NOT NULL DEFAULT 1,
  PRIMARY KEY (trip_id, kind)
);

CREATE TABLE trip_reactions (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('like', 'love', 'respect', 'laugh')),
  client_id varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (trip_id, user_id, client_id),
  UNIQUE (trip_id, user_id, kind)
);

CREATE TABLE trip_comments (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  client_id varchar(80) NOT NULL,
  position_m numeric(9, 1) NULL CHECK (position_m IS NULL OR position_m >= 0),
  body varchar(500) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  UNIQUE (trip_id, author_id, client_id)
);
CREATE INDEX trip_comments_trip_idx ON trip_comments (trip_id, created_at DESC);

-- Photos pin to a distance along the trip, not to a point seq, so pruning old
-- points never moves a photo off the line it was taken on.
CREATE TABLE trip_photos (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE RESTRICT,
  position_m numeric(9, 1) NOT NULL CHECK (position_m >= 0),
  taken_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX trip_photos_trip_idx ON trip_photos (trip_id, position_m);
CREATE UNIQUE INDEX trip_photos_media_unique ON trip_photos (media_id);

-- ---------------------------------------------------------------------------
-- Feed posts, audience, and interaction (all idempotent by client key)
-- ---------------------------------------------------------------------------

CREATE TABLE posts (
  id uuid PRIMARY KEY,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('text', 'photo', 'video', 'trip_recap')),
  audience text NOT NULL DEFAULT 'followers' CHECK (audience IN ('public', 'followers', 'community', 'private')),
  community_id uuid NULL REFERENCES communities(id) ON DELETE CASCADE,
  trip_id uuid NULL REFERENCES trips(id) ON DELETE SET NULL,
  caption varchar(2000) NULL,
  location_ref geography(Point, 4326) NULL,
  status text NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'hidden', 'removed', 'deleted')),
  client_post_id varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  CHECK (kind <> 'trip_recap' OR trip_id IS NOT NULL),
  CHECK (audience <> 'community' OR community_id IS NOT NULL),
  CHECK (community_id IS NULL OR audience = 'community'),
  UNIQUE (author_id, client_post_id)
);
-- Keyset pagination reads (created_at, id) newest-first; pin that order in one index.
CREATE INDEX posts_timeline_idx ON posts (created_at DESC, id DESC) WHERE status = 'published';
CREATE INDEX posts_author_idx ON posts (author_id, created_at DESC) WHERE status = 'published';
CREATE INDEX posts_community_idx ON posts (community_id, created_at DESC) WHERE status = 'published';


CREATE TABLE post_media (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  media_id uuid NOT NULL REFERENCES media_assets(id) ON DELETE CASCADE,
  sort_index integer NOT NULL DEFAULT 0,
  alt_text varchar(300) NULL,
  PRIMARY KEY (post_id, media_id),
  UNIQUE (media_id)
);

CREATE TABLE reactions (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('like', 'love', 'respect', 'laugh')),
  client_id varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id),
  UNIQUE (post_id, user_id, client_id)
);

CREATE TABLE comments (
  id uuid PRIMARY KEY,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  author_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  parent_id uuid NULL REFERENCES comments(id) ON DELETE CASCADE,
  client_id varchar(80) NOT NULL,
  body varchar(1000) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL,
  UNIQUE (post_id, author_id, client_id)
);
CREATE INDEX comments_post_idx ON comments (post_id, created_at DESC, id DESC);

CREATE TABLE comment_reactions (
  comment_id uuid NOT NULL REFERENCES comments(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL DEFAULT 'like' CHECK (kind IN ('like', 'love', 'respect', 'laugh')),
  client_id varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (comment_id, user_id)
);

CREATE TABLE post_saves (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (post_id, user_id)
);
CREATE INDEX post_saves_user_idx ON post_saves (user_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Albums (personal + community), quota, permission, moderation
-- ---------------------------------------------------------------------------

CREATE TABLE albums (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  community_id uuid NULL REFERENCES communities(id) ON DELETE CASCADE,
  title varchar(80) NOT NULL,
  description varchar(500) NULL,
  visibility text NOT NULL DEFAULT 'private' CHECK (visibility IN ('public', 'followers', 'community', 'private')),
  cover_media_id uuid NULL,
  quota_bytes bigint NOT NULL CHECK (quota_bytes > 0),
  used_bytes bigint NOT NULL DEFAULT 0 CHECK (used_bytes >= 0 AND used_bytes <= quota_bytes),
  client_album_id varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, client_album_id)
);
CREATE INDEX albums_owner_idx ON albums (owner_id, created_at DESC);
CREATE INDEX albums_community_idx ON albums (community_id, created_at DESC);

ALTER TABLE media_assets
  ADD CONSTRAINT media_assets_album_fk FOREIGN KEY (album_id) REFERENCES albums(id) ON DELETE SET NULL;

CREATE UNIQUE INDEX media_assets_album_position_unique
  ON media_assets (album_id, sort_index) WHERE album_id IS NOT NULL AND status <> 'deleted';

-- ---------------------------------------------------------------------------
-- Hashtags, mentions, notifications, points/badges/leaderboard
-- ---------------------------------------------------------------------------

CREATE TABLE hashtags (
  tag varchar(60) PRIMARY KEY,
  post_count integer NOT NULL DEFAULT 0
);
CREATE TABLE post_hashtags (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  tag varchar(60) NOT NULL REFERENCES hashtags(tag) ON DELETE CASCADE,
  PRIMARY KEY (post_id, tag)
);
CREATE INDEX post_hashtags_tag_idx ON post_hashtags (tag);

CREATE TABLE mentions (
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  comment_id uuid NULL REFERENCES comments(id) ON DELETE CASCADE,
  mentioned_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK (post_id IS NOT NULL OR comment_id IS NOT NULL)
);
CREATE INDEX mentions_target_idx ON mentions (mentioned_id, created_at DESC);

CREATE TABLE notifications (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('follow', 'follow_request', 'follow_accepted', 'like', 'comment', 'mention', 'save', 'hazard_nearby')),
  thread_key varchar(120) NOT NULL,
  source_user_id uuid NULL REFERENCES users(id) ON DELETE CASCADE,
  post_id uuid NULL REFERENCES posts(id) ON DELETE CASCADE,
  comment_id uuid NULL REFERENCES comments(id) ON DELETE CASCADE,
  payload jsonb NOT NULL DEFAULT '{}'::jsonb,
  unread boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  read_at timestamptz NULL,
  UNIQUE (user_id, thread_key)
);
CREATE INDEX notifications_user_idx ON notifications (user_id, unread, created_at DESC);

CREATE TABLE notification_preferences (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  mention boolean NOT NULL DEFAULT true,
  comment boolean NOT NULL DEFAULT true,
  follow boolean NOT NULL DEFAULT true,
  hazard boolean NOT NULL DEFAULT true,
  quiet_nav boolean NOT NULL DEFAULT true,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE push_devices (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  platform text NOT NULL CHECK (platform IN ('android', 'ios')),
  created_at timestamptz NOT NULL DEFAULT now(),
  last_seen_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE point_ledger (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  delta integer NOT NULL CHECK (delta <> 0),
  -- Participation and safety-checklist reasons only. Speeding, distance, or
  -- phone-in-hand while moving are not representable, so no path can award them.
  reason text NOT NULL CHECK (reason IN ('safety_checklist', 'community_event_rsvp', 'effective_hazard_report', 'clean_comment', 'new_badge')),
  reference_type text NOT NULL CHECK (reference_type IN ('trip', 'community', 'hazard', 'comment', 'event', 'badge')),
  reference_id uuid NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  -- One award per (user, reason, reference). Replays and retries cannot mint points.
  UNIQUE (user_id, reason, reference_id)
);
CREATE INDEX point_ledger_user_idx ON point_ledger (user_id, created_at DESC);

CREATE TABLE badges (
  code text PRIMARY KEY,
  title varchar(60) NOT NULL,
  description varchar(200) NOT NULL,
  criteria jsonb NOT NULL,
  for_safe_riding boolean NOT NULL DEFAULT true
);
CREATE TABLE user_badges (
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  badge_code text NOT NULL REFERENCES badges(code) ON DELETE CASCADE,
  awarded_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, badge_code)
);


CREATE INDEX user_badges_badge_idx ON user_badges (badge_code, awarded_at DESC);

-- Leaderboard is opt-in and sums safety/participation points only. No trip metric
-- is joined in, so speed or distance can never move a rank, and a rider who never
-- opts in is never listed.
CREATE VIEW leaderboard_entries AS
  SELECT p.user_id, sum(l.delta)::int AS points
  FROM rider_profiles p
  JOIN point_ledger l ON l.user_id = p.user_id
  WHERE p.leaderboard_opt_in
  GROUP BY p.user_id;
-- ---------------------------------------------------------------------------
-- Posters: server-rendered from a fixed original template set, never user HTML
-- ---------------------------------------------------------------------------

CREATE TABLE posters (
  id uuid PRIMARY KEY,
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  template text NOT NULL CHECK (template IN ('first_light', 'peloton_lines', 'night_odometer')),
  title varchar(80) NOT NULL,
  subtitle varchar(120) NULL,
  stats jsonb NOT NULL,
  -- Rendered file lives in object storage; this row only points at it.
  media_id uuid NULL REFERENCES media_assets(id) ON DELETE SET NULL,
  render_state text NOT NULL DEFAULT 'queued' CHECK (render_state IN ('queued', 'rendering', 'ready', 'failed')),
  render_error varchar(200) NULL,
  client_poster_id varchar(80) NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (owner_id, client_poster_id)
);
CREATE INDEX posters_trip_idx ON posters (trip_id, created_at DESC);

-- Feed read receipts make "seen" pagination stable when new posts arrive mid-scroll.
CREATE TABLE feed_read_cursors (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  post_id uuid NOT NULL REFERENCES posts(id) ON DELETE CASCADE,
  created_at timestamptz NOT NULL DEFAULT now()
);
