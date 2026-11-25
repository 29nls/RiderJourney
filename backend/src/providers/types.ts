export type LatLng = { lat: number; lng: number };
export type Waypoint = LatLng & { label?: string };

export type RouteRequest = {
  origin: LatLng;
  destination: LatLng;
  waypoints: Waypoint[];
  alternatives: boolean;
};

export type RouteOption = {
  distanceM: number;
  durationS: number;
  geometry: { type: 'LineString'; coordinates: number[][] };
  provider: string;
};

export type PlaceResult = {
  providerRef: string | null;
  name: string;
  category: string | null;
  location: LatLng;
};

export class ProviderFailure extends Error {
  constructor(
    readonly code: 'PROVIDER_NOT_CONFIGURED' | 'PROVIDER_UNAVAILABLE' | 'PROVIDER_INVALID_RESPONSE',
    message: string,
  ) {
    super(message);
  }
}

export interface RoutingProvider {
  readonly name: string;
  preview(request: RouteRequest): Promise<RouteOption[]>;
}

export interface GeocodingProvider {
  readonly name: string;
  search(query: string, limit: number): Promise<PlaceResult[]>;
}

export const ROUTING_PROVIDER = Symbol('ROUTING_PROVIDER');
export const GEOCODING_PROVIDER = Symbol('GEOCODING_PROVIDER');
