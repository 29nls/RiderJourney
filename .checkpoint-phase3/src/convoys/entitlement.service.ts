import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.js';

@Injectable()
export class EntitlementService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async convoyCapacity(userId: string): Promise<number> {
    const rows = await this.db.query<{ convoy_capacity: number }>(
      'SELECT convoy_capacity FROM user_entitlements WHERE user_id = $1',
      [userId],
    );
    const entitled = rows[0]?.convoy_capacity ?? this.config.convoyCapacityDefault;
    return Math.min(entitled, this.config.convoyCapacityMax);
  }
}
