import { Body, Controller, Get, Headers, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserRow } from '../auth/auth.types.js';
import { BillingService } from './billing.service.js';
import { RestorePurchasesDto, VerifyPurchaseDto } from './billing.dto.js';

@Controller('v1')
@UseGuards(AuthGuard)
export class BillingController {
  constructor(private readonly billing: BillingService) {}

  @Get('subscription')
  current(@CurrentUser() user: UserRow) {
    return this.billing.current(user.id);
  }

  @Get('billing/catalog')
  catalog() {
    return this.billing.catalog();
  }

  @Post('billing/verify')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  verify(@CurrentUser() user: UserRow, @Body() dto: VerifyPurchaseDto) {
    return this.billing.verify(user.id, dto);
  }

  @Post('billing/restore')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  restore(@CurrentUser() user: UserRow, @Body() dto: RestorePurchasesDto) {
    return this.billing.restore(user.id, dto.purchases);
  }
}

/** Pub/Sub push target. Authenticated by the shared notification secret header. */
@Controller('v1/billing')
export class BillingWebhookController {
  constructor(private readonly billing: BillingService) {}

  @Post('notifications')
  @HttpCode(200)
  notification(
    @Headers('x-billing-secret') secret: string | undefined,
    @Body() body: { message?: { data?: string; messageId?: string; attributes?: Record<string, string> } },
  ) {
    return this.billing.notification(secret ?? '', body);
  }
}
