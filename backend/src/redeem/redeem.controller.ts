import { Body, Controller, Get, HttpCode, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserRow } from '../auth/auth.types.js';
import { RedeemDto } from './redeem.dto.js';
import { RedeemService } from './redeem.service.js';

@Controller('v1')
@UseGuards(AuthGuard)
export class RedeemController {
  constructor(private readonly redeem: RedeemService) {}

  @Post('redeem')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  redeemCode(@CurrentUser() user: UserRow, @Body() dto: RedeemDto) {
    return this.redeem.redeem(user.id, dto);
  }

  @Get('me/redemptions')
  history(@CurrentUser() user: UserRow) {
    return this.redeem.history(user.id);
  }
}
