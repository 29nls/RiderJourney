import { Inject, Injectable } from '@nestjs/common';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { PlanService } from '../entitlements/plan.service.js';

@Injectable()
export class EntitlementService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    private readonly plans: PlanService,
  ) {}

  async convoyCapacity(userId: string): Promise<number> {
    const limits = await this.plans.limits(userId);
    return Math.min(limits.convoyCapacity, this.config.convoyCapacityMax);
  }
}
