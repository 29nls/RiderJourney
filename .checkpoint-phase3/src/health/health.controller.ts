import { Controller, Get, Inject, ServiceUnavailableException } from '@nestjs/common';
import { DATABASE, type Database } from '../db/database.js';

@Controller('health')
export class HealthController {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  @Get('live')
  live() {
    return { status: 'ok' };
  }

  @Get('ready')
  async ready() {
    try {
      await this.db.query('SELECT 1');
      const rows = await this.db.query<{ postgis_version: string }>('SELECT postgis_version() AS postgis_version');
      return { status: 'ok', database: 'ok', postgis: rows[0]?.postgis_version ?? null };
    } catch {
      throw new ServiceUnavailableException({
        code: 'DEPENDENCY_UNAVAILABLE',
        title: 'Layanan belum siap',
        detail: 'Database atau PostGIS tidak tersedia.',
      });
    }
  }
}
