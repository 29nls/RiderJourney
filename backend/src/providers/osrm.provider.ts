import { ProviderFailure, type RouteOption, type RouteRequest, type RoutingProvider } from './types.js';

type OsrmResponse = {
  code?: string;
  routes?: Array<{
    distance: number;
    duration: number;
    geometry?: { type: string; coordinates: number[][] };
  }>;
};

export class OsrmRoutingProvider implements RoutingProvider {
  readonly name = 'osrm';
  constructor(private readonly baseUrl: string, private readonly apiKey: string) {}

  async preview(request: RouteRequest): Promise<RouteOption[]> {
    const points = [request.origin, ...request.waypoints, request.destination];
    const coordinates = points.map((p) => `${p.lng},${p.lat}`).join(';');
    const url = new URL(`/route/v1/driving/${coordinates}`, this.baseUrl);
    url.searchParams.set('overview', 'full');
    url.searchParams.set('geometries', 'geojson');
    url.searchParams.set('alternatives', request.alternatives ? 'true' : 'false');
    url.searchParams.set('steps', 'false');

    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: this.apiKey ? { 'X-Api-Key': this.apiKey } : {},
      });
    } catch {
      throw new ProviderFailure('PROVIDER_UNAVAILABLE', 'Routing provider tidak dapat dihubungi.');
    }
    if (!response.ok) {
      throw new ProviderFailure('PROVIDER_UNAVAILABLE', `Routing provider mengembalikan HTTP ${response.status}.`);
    }
    const body = (await response.json().catch(() => null)) as OsrmResponse | null;
    if (!body || body.code !== 'Ok' || !Array.isArray(body.routes)) return [];
    return body.routes
      .filter((r) => r.geometry?.type === 'LineString' && Array.isArray(r.geometry.coordinates) && r.geometry.coordinates.length >= 2)
      .map((r) => ({
        distanceM: Math.round(r.distance),
        durationS: Math.round(r.duration),
        geometry: { type: 'LineString' as const, coordinates: r.geometry!.coordinates },
        provider: this.name,
      }));
  }
}
