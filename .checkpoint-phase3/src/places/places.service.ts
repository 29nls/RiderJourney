import { Inject, Injectable } from '@nestjs/common';
import { GEOCODING_PROVIDER, type GeocodingProvider } from '../providers/types.js';
import { throwProviderError } from '../providers/error.js';

@Injectable()
export class PlacesService {
  constructor(@Inject(GEOCODING_PROVIDER) private readonly geocoding: GeocodingProvider) {}

  async search(query: string, limit = 8) {
    try {
      const items = await this.geocoding.search(query.trim(), limit);
      return { items, provider: this.geocoding.name };
    } catch (error) {
      throwProviderError(error);
    }
  }
}
