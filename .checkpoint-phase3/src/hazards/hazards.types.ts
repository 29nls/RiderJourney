export type HazardKind =
  | 'road_damage'
  | 'accident'
  | 'congestion'
  | 'police'
  | 'weather'
  | 'obstacle'
  | 'other';
export type HazardStatus = 'active' | 'expired' | 'removed';

export type HazardRow = {
  id: string;
  reporter_id: string;
  kind: HazardKind;
  lat: number;
  lng: number;
  note: string | null;
  photo_media_id: string | null;
  status: HazardStatus;
  moderation_status: 'visible' | 'hidden' | 'removed';
  expires_at: Date;
  still_present_count: number;
  not_relevant_count: number;
  last_confirmed_at: Date | null;
  duplicate_of_id: string | null;
  created_at: Date;
  updated_at: Date;
  display_name?: string;
  username?: string;
  distance_m?: number | null;
};

// A hazard is only a live warning while all three flags agree. Anything stale,
// expired, hidden by moderation, or merged into a newer report is shown to riders
// as history with `stale: true` / `active: false`, never as renewed danger.
export const ACTIVE_HAZARD_FILTER =
  `status = 'active' AND moderation_status = 'visible' AND expires_at > now()`;
