import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { BillingModule } from '../billing/billing.module.js';
import { OpsModule } from '../ops/ops.module.js';
import { MediaModule } from '../media/media.module.js';
import { RedeemModule } from '../redeem/redeem.module.js';
import { AdminAuditService } from './admin.audit.js';
import { AdminBootstrapService } from './admin.bootstrap.js';
import { AdminController } from './admin.controller.js';
import { AdminGuard, AdminStepUpGuard } from './admin.guard.js';
import { AdminService } from './admin.service.js';
import { AdminStepUpService } from './step-up.service.js';

@Module({
  imports: [AuthModule, BillingModule, RedeemModule, OpsModule, MediaModule],
  controllers: [AdminController],
  providers: [
    AdminService, AdminAuditService, AdminStepUpService,
    AdminGuard, AdminStepUpGuard, AdminBootstrapService,
  ],
  exports: [AdminBootstrapService],
})
export class AdminModule {}
