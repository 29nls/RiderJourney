-- Phase 1 core schema. PostgreSQL 16+ with PostGIS.
CREATE EXTENSION IF NOT EXISTS postgis;

CREATE TABLE users (
  id uuid PRIMARY KEY,
  email text NOT NULL,
  username text NOT NULL,
  password_hash text NULL,
  display_name text NOT NULL,
  bio text NULL,
  city text NULL,
  avatar_url text NULL,
  visibility text NOT NULL DEFAULT 'public' CHECK (visibility IN ('public', 'followers', 'private')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended', 'deletion_pending', 'deleted')),
  email_verified boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX users_email_unique ON users (lower(email));
CREATE UNIQUE INDEX users_username_unique ON users (lower(username));

CREATE TABLE user_settings (
  user_id uuid PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  location_sharing_default boolean NOT NULL DEFAULT false,
  trip_history_visibility text NOT NULL DEFAULT 'private' CHECK (trip_history_visibility IN ('private', 'followers', 'public')),
  notification_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  audio_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  map_preferences jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE user_consents (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('terms', 'privacy', 'location_disclosure', 'microphone_disclosure')),
  version text NOT NULL,
  context text NULL,
  granted_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz NULL
);
CREATE INDEX user_consents_user_idx ON user_consents (user_id, kind, granted_at DESC);

CREATE TABLE refresh_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz NULL,
  replaced_by uuid NULL,
  user_agent text NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_idx ON refresh_tokens (user_id);

CREATE TABLE one_time_tokens (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  kind text NOT NULL CHECK (kind IN ('email_verify', 'password_reset')),
  token_hash text NOT NULL UNIQUE,
  expires_at timestamptz NOT NULL,
  used_at timestamptz NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE vehicles (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  type text NOT NULL CHECK (type IN ('motorcycle', 'car', 'other')),
  brand text NOT NULL,
  model text NOT NULL,
  year smallint NULL CHECK (year IS NULL OR (year >= 1900 AND year <= 2100)),
  engine_cc integer NULL CHECK (engine_cc IS NULL OR (engine_cc >= 0 AND engine_cc <= 3000)),
  nickname text NULL,
  photo_url text NULL,
  plate_ciphertext bytea NULL,
  plate_iv bytea NULL,
  plate_tag bytea NULL,
  plate_key_version smallint NULL,
  is_primary boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  deleted_at timestamptz NULL
);
CREATE INDEX vehicles_owner_idx ON vehicles (owner_id) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX vehicles_one_primary ON vehicles (owner_id) WHERE is_primary AND deleted_at IS NULL;

CREATE TABLE routes (
  id uuid PRIMARY KEY,
  owner_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name text NULL,
  route_geometry geometry(LineString, 4326) NOT NULL,
  waypoints jsonb NOT NULL DEFAULT '[]'::jsonb,
  distance_m integer NOT NULL,
  duration_s integer NOT NULL,
  provider text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX routes_owner_idx ON routes (owner_id, created_at DESC);
CREATE INDEX routes_geometry_idx ON routes USING gist (route_geometry);

CREATE TABLE trips (
  id uuid PRIMARY KEY,
  user_id uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  vehicle_id uuid NULL REFERENCES vehicles(id) ON DELETE SET NULL,
  route_id uuid NULL REFERENCES routes(id) ON DELETE SET NULL,
  status text NOT NULL CHECK (status IN ('active', 'paused', 'finished')),
  started_at timestamptz NOT NULL DEFAULT now(),
  ended_at timestamptz NULL,
  paused_at timestamptz NULL,
  paused_seconds integer NOT NULL DEFAULT 0,
  distance_m integer NOT NULL DEFAULT 0,
  duration_s integer NOT NULL DEFAULT 0,
  avg_speed_kph numeric(5,1) NULL,
  point_count integer NOT NULL DEFAULT 0,
  data_quality jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX trips_one_open ON trips (user_id) WHERE status IN ('active', 'paused');
CREATE INDEX trips_user_idx ON trips (user_id, started_at DESC);

CREATE TABLE trip_points (
  trip_id uuid NOT NULL REFERENCES trips(id) ON DELETE CASCADE,
  seq integer NOT NULL CHECK (seq >= 0),
  location geography(Point, 4326) NOT NULL,
  accuracy_m real NOT NULL CHECK (accuracy_m >= 0 AND accuracy_m <= 10000),
  speed_mps real NULL,
  heading_deg real NULL,
  recorded_at timestamptz NOT NULL,
  quality text NOT NULL DEFAULT 'ok' CHECK (quality IN ('ok', 'low_accuracy', 'spike', 'gap')),
  created_at timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (trip_id, seq)
);
CREATE INDEX trip_points_trip_idx ON trip_points (trip_id, seq);
CREATE INDEX trip_points_location_idx ON trip_points USING gist (location);
