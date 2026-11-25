import { ProviderFailure, type GeocodingProvider, type PlaceResult, type RouteOption, type RouteRequest, type RoutingProvider } from './types.js';

export class UnconfiguredRoutingProvider implements RoutingProvider {
  readonly name = 'unconfigured';
  async preview(_request: RouteRequest): Promise<RouteOption[]> {
    throw new ProviderFailure('PROVIDER_NOT_CONFIGURED', 'Routing provider belum dikonfigurasi.');
  }
}

export class UnconfiguredGeocodingProvider implements GeocodingProvider {
  readonly name = 'unconfigured';
  async search(_query: string, _limit: number): Promise<PlaceResult[]> {
    throw new ProviderFailure('PROVIDER_NOT_CONFIGURED', 'Geocoding provider belum dikonfigurasi.');
  }
}
