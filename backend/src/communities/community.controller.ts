import { Body, Controller, Get, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserRow } from '../auth/auth.types.js';
import { CreateCommunityDto, SetCommunityRoleDto } from './community.dto.js';
import { CommunityService } from './community.service.js';

@Controller('v1/communities')
@UseGuards(AuthGuard)
export class CommunityController {
  constructor(private readonly communities: CommunityService) {}

  @Post()
  @HttpCode(201)
  create(@CurrentUser() user: UserRow, @Body() dto: CreateCommunityDto) {
    return this.communities.create(user.id, dto);
  }

  @Get(':id')
  detail(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.communities.detail(user.id, id);
  }

  @Post(':id/join')
  @HttpCode(200)
  join(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.communities.join(user.id, id);
  }

  @Get(':id/members')
  members(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.communities.members(user.id, id);
  }

  @Get(':id/join-requests')
  joinRequests(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.communities.joinRequests(user.id, id);
  }

  @Post(':id/join-requests/:userId/approve')
  @HttpCode(200)
  approve(@CurrentUser() user: UserRow, @Param('id') id: string, @Param('userId') userId: string) {
    return this.communities.approve(user.id, id, userId);
  }

  @Post(':id/join-requests/:userId/decline')
  @HttpCode(200)
  decline(@CurrentUser() user: UserRow, @Param('id') id: string, @Param('userId') userId: string) {
    return this.communities.decline(user.id, id, userId);
  }

  @Patch(':id/members/:userId/role')
  setRole(
    @CurrentUser() user: UserRow,
    @Param('id') id: string,
    @Param('userId') userId: string,
    @Body() dto: SetCommunityRoleDto,
  ) {
    return this.communities.setRole(user.id, id, userId, dto);
  }
}
