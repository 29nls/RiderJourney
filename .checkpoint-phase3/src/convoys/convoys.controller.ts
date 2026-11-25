import { Body, Controller, Delete, Get, Headers, HttpCode, Param, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserRow } from '../auth/auth.types.js';
import {
  ChangeMemberRoleDto,
  CreateConvoyDto,
  CreateInviteDto,
  JoinConvoyDto,
  RejectMemberDto,
  TransferLeadershipDto,
  UpdateConvoyRouteDto,
  UpdateSharingDto,
} from './convoys.dto.js';
import { ConvoysService } from './convoys.service.js';

@Controller('v1/convoys')
@UseGuards(AuthGuard)
export class ConvoysController {
  constructor(private readonly convoys: ConvoysService) {}

  @Get()
  list(@CurrentUser() user: UserRow) {
    return this.convoys.list(user.id);
  }

  @Get('active')
  active(@CurrentUser() user: UserRow) {
    return this.convoys.active(user.id);
  }

  @Post()
  create(@CurrentUser() user: UserRow, @Body() dto: CreateConvoyDto) {
    return this.convoys.create(user.id, dto);
  }

  @Post('join')
  @HttpCode(201)
  join(@CurrentUser() user: UserRow, @Body() dto: JoinConvoyDto) {
    return this.convoys.join(user.id, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.convoys.get(id, user.id);
  }

  @Get(':id/members')
  members(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.convoys.members(id, user.id);
  }

  @Get(':id/positions')
  positions(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.convoys.positions(id, user.id);
  }

  @Patch(':id/sharing')
  sharing(@CurrentUser() user: UserRow, @Param('id') id: string, @Body() dto: UpdateSharingDto) {
    return this.convoys.updateSharing(id, user.id, dto.sharingConsent);
  }

  @Get(':id/invites')
  invites(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.convoys.listInvites(id, user.id);
  }

  @Post(':id/invites')
  createInvite(@CurrentUser() user: UserRow, @Param('id') id: string, @Body() dto: CreateInviteDto) {
    return this.convoys.createInvite(id, user.id, dto);
  }

  @Delete(':id/invites/:inviteId')
  revokeInvite(@CurrentUser() user: UserRow, @Param('id') id: string, @Param('inviteId') inviteId: string) {
    return this.convoys.revokeInvite(id, inviteId, user.id);
  }

  @Post(':id/members/:userId/approve')
  @HttpCode(200)
  approve(
    @CurrentUser() user: UserRow,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.convoys.approve(id, targetUserId, user.id, ifMatch);
  }

  @Post(':id/members/:userId/reject')
  @HttpCode(200)
  reject(
    @CurrentUser() user: UserRow,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Body() _dto: RejectMemberDto,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.convoys.reject(id, targetUserId, user.id, ifMatch);
  }

  @Delete(':id/members/:userId')
  remove(
    @CurrentUser() user: UserRow,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.convoys.remove(id, targetUserId, user.id, ifMatch);
  }

  @Patch(':id/members/:userId')
  changeRole(
    @CurrentUser() user: UserRow,
    @Param('id') id: string,
    @Param('userId') targetUserId: string,
    @Body() dto: ChangeMemberRoleDto,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.convoys.changeRole(id, targetUserId, user.id, dto, ifMatch);
  }

  @Post(':id/transfer')
  @HttpCode(200)
  transfer(
    @CurrentUser() user: UserRow,
    @Param('id') id: string,
    @Body() dto: TransferLeadershipDto,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.convoys.transferLeadership(id, user.id, dto.userId, ifMatch);
  }

  @Post(':id/leave')
  @HttpCode(200)
  leave(@CurrentUser() user: UserRow, @Param('id') id: string, @Headers('if-match') ifMatch?: string) {
    return this.convoys.leave(id, user.id, ifMatch);
  }

  @Patch(':id/route')
  route(
    @CurrentUser() user: UserRow,
    @Param('id') id: string,
    @Body() dto: UpdateConvoyRouteDto,
    @Headers('if-match') ifMatch?: string,
  ) {
    return this.convoys.updateRoute(id, user.id, dto, ifMatch);
  }

  @Post(':id/publish')
  @HttpCode(200)
  publish(@CurrentUser() user: UserRow, @Param('id') id: string, @Headers('if-match') ifMatch?: string) {
    return this.convoys.transition(id, user.id, 'lobby', ifMatch);
  }

  @Post(':id/start')
  @HttpCode(200)
  start(@CurrentUser() user: UserRow, @Param('id') id: string, @Headers('if-match') ifMatch?: string) {
    return this.convoys.transition(id, user.id, 'active', ifMatch);
  }

  @Post(':id/pause')
  @HttpCode(200)
  pause(@CurrentUser() user: UserRow, @Param('id') id: string, @Headers('if-match') ifMatch?: string) {
    return this.convoys.transition(id, user.id, 'paused', ifMatch);
  }

  @Post(':id/resume')
  @HttpCode(200)
  resume(@CurrentUser() user: UserRow, @Param('id') id: string, @Headers('if-match') ifMatch?: string) {
    return this.convoys.transition(id, user.id, 'active', ifMatch);
  }

  @Post(':id/complete')
  @HttpCode(200)
  complete(@CurrentUser() user: UserRow, @Param('id') id: string, @Headers('if-match') ifMatch?: string) {
    return this.convoys.transition(id, user.id, 'completed', ifMatch);
  }

  @Post(':id/end')
  @HttpCode(200)
  end(@CurrentUser() user: UserRow, @Param('id') id: string, @Headers('if-match') ifMatch?: string) {
    return this.convoys.transition(id, user.id, 'completed', ifMatch);
  }

  @Post(':id/cancel')
  @HttpCode(200)
  cancel(@CurrentUser() user: UserRow, @Param('id') id: string, @Headers('if-match') ifMatch?: string) {
    return this.convoys.transition(id, user.id, 'cancelled', ifMatch);
  }
}
