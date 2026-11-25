import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserRow } from '../auth/auth.types.js';
import { ReportContentDto, UpdateProfileDto } from './social.dto.js';
import { SocialService } from './social.service.js';

@Controller('v1')
@UseGuards(AuthGuard)
export class SocialController {
  constructor(private readonly social: SocialService) {}

  @Get('me/rider-profile')
  me(@CurrentUser() user: UserRow) {
    return this.social.me(user.id);
  }

  @Patch('me/rider-profile')
  update(@CurrentUser() user: UserRow, @Body() dto: UpdateProfileDto) {
    return this.social.updateProfile(user.id, dto);
  }

  @Get('users/:id')
  profile(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.social.publicProfile(user.id, id);
  }

  @Post('users/:id/follow')
  @HttpCode(200)
  follow(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.social.follow(user.id, id);
  }

  @Delete('users/:id/follow')
  @HttpCode(200)
  unfollow(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.social.unfollow(user.id, id);
  }

  @Get('me/follow-requests')
  requests(@CurrentUser() user: UserRow) {
    return this.social.followRequests(user.id);
  }

  @Post('me/follow-requests/:requesterId/accept')
  @HttpCode(200)
  accept(@CurrentUser() user: UserRow, @Param('requesterId') requesterId: string) {
    return this.social.respondToRequest(user.id, requesterId, true);
  }

  @Post('me/follow-requests/:requesterId/decline')
  @HttpCode(200)
  decline(@CurrentUser() user: UserRow, @Param('requesterId') requesterId: string) {
    return this.social.respondToRequest(user.id, requesterId, false);
  }

  @Post('users/:id/block')
  @HttpCode(200)
  block(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.social.block(user.id, id);
  }

  @Delete('users/:id/block')
  @HttpCode(200)
  unblock(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.social.unblock(user.id, id);
  }

  @Get('me/blocked')
  blocked(@CurrentUser() user: UserRow) {
    return this.social.blockList(user.id);
  }

  @Post('users/:id/mute')
  @HttpCode(200)
  mute(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.social.mute(user.id, id);
  }

  @Delete('users/:id/mute')
  @HttpCode(200)
  unmute(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.social.unmute(user.id, id);
  }

  @Post('reports')
  @HttpCode(201)
  report(@CurrentUser() user: UserRow, @Body() dto: ReportContentDto) {
    return this.social.report(user.id, dto);
  }

  @Delete('me/social-data')
  @HttpCode(200)
  purge(@CurrentUser() user: UserRow) {
    return this.social.purgeSocialData(user.id);
  }
}
