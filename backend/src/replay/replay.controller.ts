import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserRow } from '../auth/auth.types.js';
import { CreateTripPhotoDto, ShareTripDto } from './replay.dto.js';
import { ReplayService } from './replay.service.js';

@Controller('v1/trips')
@UseGuards(AuthGuard)
export class ReplayController {
  constructor(private readonly replay: ReplayService) {}

  @Get(':id/replay')
  view(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.replay.replay(user.id, id);
  }

  @Get(':id/photos')
  photos(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.replay.photos(id, user.id);
  }

  @Post(':id/photos')
  @HttpCode(201)
  addPhoto(@CurrentUser() user: UserRow, @Param('id') id: string, @Body() dto: CreateTripPhotoDto) {
    return this.replay.addPhoto(user.id, id, dto);
  }

  @Patch(':id/share')
  share(@CurrentUser() user: UserRow, @Param('id') id: string, @Body() dto: ShareTripDto) {
    return this.replay.share(user.id, id, dto.userIds);
  }
}
