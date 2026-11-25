import { ServiceUnavailableException } from '@nestjs/common';
import { ProviderFailure } from './types.js';

export function throwProviderError(error: unknown): never {
  if (error instanceof ProviderFailure) {
    const status = error.code === 'PROVIDER_NOT_CONFIGURED' ? 503 : 503;
    throw new ServiceUnavailableException({
      status,
      code: error.code,
      title: error.code === 'PROVIDER_NOT_CONFIGURED' ? 'Provider belum dikonfigurasi' : 'Provider tidak tersedia',
      detail: error.message,
      retryAfterSeconds: 30,
    });
  }
  throw error;
}
