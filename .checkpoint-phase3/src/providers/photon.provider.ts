import { ProviderFailure, type GeocodingProvider, type PlaceResult } from './types.js';

type PhotonResponse = {
  features?: Array<{
    geometry?: { coordinates?: number[] };
    properties?: Record<string, unknown>;
  }>;
};

export class PhotonGeocodingProvider implements GeocodingProvider {
  readonly name = 'photon';
  constructor(private readonly baseUrl: string, private readonly apiKey: string) {}

  async search(query: string, limit: number): Promise<PlaceResult[]> {
    const url = new URL('/api', this.baseUrl);
    url.searchParams.set('q', query);
    url.searchParams.set('limit', String(limit));
    url.searchParams.set('lang', 'id');
    let response: Response;
    try {
      response = await fetch(url, {
        signal: AbortSignal.timeout(8000),
        headers: this.apiKey ? { 'X-Api-Key': this.apiKey } : {},
      });
    } catch {
      throw new ProviderFailure('PROVIDER_UNAVAILABLE', 'Geocoding provider tidak dapat dihubungi.');
    }
    if (!response.ok) {
      throw new ProviderFailure('PROVIDER_UNAVAILABLE', `Geocoding provider mengembalikan HTTP ${response.status}.`);
    }
    const body = (await response.json().catch(() => null)) as PhotonResponse | null;
    if (!body?.features) return [];
    const results: PlaceResult[] = [];
    for (const feature of body.features) {
      const coordinates = feature.geometry?.coordinates;
      if (!coordinates || coordinates.length < 2) continue;
      const props = feature.properties ?? {};
      const name = String(props.name ?? props.street ?? props.city ?? '').trim();
      if (!name) continue;
      results.push({
        providerRef: props.osm_id ? `${props.osm_type ?? 'osm'}/${props.osm_id}` : null,
        name,
        category: props.osm_value ? String(props.osm_value) : null,
        location: { lat: coordinates[1], lng: coordinates[0] },
      });
    }
    return results;
  }
}
