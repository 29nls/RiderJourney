import { Module } from '@nestjs/common';
import { AuthModule } from '../auth/auth.module.js';
import { EntitlementsModule } from '../entitlements/entitlements.module.js';
import { BillingController, BillingWebhookController } from './billing.controller.js';
import { BillingService } from './billing.service.js';
import { GooglePlayVerifier } from './google-play.verifier.js';
import { PURCHASE_VERIFIER } from './billing.types.js';

@Module({
  imports: [AuthModule, EntitlementsModule],
  controllers: [BillingController, BillingWebhookController],
  providers: [
    BillingService,
    GooglePlayVerifier,
    { provide: PURCHASE_VERIFIER, useExisting: GooglePlayVerifier },
  ],
  exports: [BillingService, PURCHASE_VERIFIER],
})
export class BillingModule {}
