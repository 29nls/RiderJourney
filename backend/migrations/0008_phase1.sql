-- Phase 1 close-out: honest trip statistics and route endpoints needed to
-- recalculate a saved route from the provider without inventing coordinates.
ALTER TABLE trips
  ADD COLUMN moving_seconds integer NOT NULL DEFAULT 0,
  ADD COLUMN max_speed_kph numeric(5,1) NULL,
  ADD COLUMN start_point geography(Point, 4326) NULL,
  ADD COLUMN end_point geography(Point, 4326) NULL;

ALTER TABLE routes
  ADD COLUMN origin geography(Point, 4326) NULL,
  ADD COLUMN destination geography(Point, 4326) NULL,
  ADD COLUMN updated_at timestamptz NOT NULL DEFAULT now();
