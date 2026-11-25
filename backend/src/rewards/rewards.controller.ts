import { Controller, Get, HttpCode, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserRow } from '../auth/auth.types.js';
import { LeaderboardQueryDto } from './rewards.dto.js';
import { RewardsService } from './rewards.service.js';

@Controller('v1')
@UseGuards(AuthGuard)
export class RewardsController {
  constructor(private readonly rewards: RewardsService) {}

  @Get('me/points')
  points(@CurrentUser() user: UserRow) {
    return this.rewards.points(user.id);
  }

  @Post('me/safety-checklist')
  @HttpCode(200)
  checklist(@CurrentUser() user: UserRow) {
    return this.rewards.safetyChecklist(user.id);
  }

  @Get('me/badges')
  badges(@CurrentUser() user: UserRow) {
    return this.rewards.badges(user.id);
  }

  @Post('me/badges/evaluate')
  @HttpCode(200)
  evaluate(@CurrentUser() user: UserRow) {
    return this.rewards.evaluateBadges(user.id);
  }

  @Get('leaderboard')
  leaderboard(@CurrentUser() user: UserRow, @Query() query: LeaderboardQueryDto) {
    return this.rewards.leaderboard(user.id, query.limit ?? 50);
  }
}
