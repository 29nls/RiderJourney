import {
  Body, Controller, Get, HttpCode, Param, Patch, Post, Put, Query, Req, UseGuards,
} from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { AuthGuard } from '../auth/auth.guard.js';
import { AdminGuard, AdminStepUpGuard, type AdminRequest } from './admin.guard.js';
import { AdminService } from './admin.service.js';
import { AdminStepUpService } from './step-up.service.js';
import type { AdminActor } from './admin.types.js';
import {
  AuditQueryDto, CommunityModerationDto, ConfirmMfaDto, CreateRedeemDto, GrantSubscriptionDto,
  ListQueryDto, PostModerationDto, RedeemActionDto, ResolveReportDto, UpdateConfigDto, UserStatusDto,
} from './admin.dto.js';

@Controller('v1/admin')
@UseGuards(AuthGuard, AdminGuard)
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly mfa: AdminStepUpService,
  ) {}

  private actor(req: AdminRequest): AdminActor {
    return req.admin;
  }

  @Get('me')
  me(@Req() req: AdminRequest) {
    return this.admin.me(this.actor(req));
  }

  @Post('mfa/enroll')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  enroll(@Req() req: AdminRequest) {
    return this.mfa.enroll(req.admin.userId);
  }

  @Post('mfa/confirm')
  @HttpCode(200)
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  confirm(@Req() req: AdminRequest, @Body() dto: ConfirmMfaDto) {
    return this.mfa.confirm(req.admin.userId, dto.code);
  }

  @Post('mfa/step-up')
  @HttpCode(200)
  @Throttle({ default: { limit: 10, ttl: 60_000 } })
  stepUp(@Req() req: AdminRequest, @Body() dto: ConfirmMfaDto) {
    return this.mfa.stepUp(req.admin.userId, dto.code);
  }

  @Get('dashboard')
  dashboard(@Req() req: AdminRequest) {
    return this.admin.dashboard(this.actor(req));
  }

  @Get('users')
  users(@Req() req: AdminRequest, @Query() query: ListQueryDto) {
    return this.admin.listUsers(this.actor(req), query);
  }

  @Get('users/:id')
  user(@Req() req: AdminRequest, @Param('id') id: string) {
    return this.admin.userDetail(this.actor(req), id);
  }

  @Patch('users/:id/status')
  @UseGuards(AdminStepUpGuard)
  setUserStatus(@Req() req: AdminRequest, @Param('id') id: string, @Body() dto: UserStatusDto) {
    return this.admin.setUserStatus(this.actor(req), id, dto, req.requestId);
  }

  @Get('reports')
  reports(@Req() req: AdminRequest, @Query() query: ListQueryDto) {
    return this.admin.listReports(this.actor(req), query);
  }

  @Patch('reports/:id')
  @UseGuards(AdminStepUpGuard)
  resolveReport(@Req() req: AdminRequest, @Param('id') id: string, @Body() dto: ResolveReportDto) {
    return this.admin.resolveReport(this.actor(req), id, dto, req.requestId);
  }

  @Get('posts')
  posts(@Req() req: AdminRequest, @Query() query: ListQueryDto) {
    return this.admin.listPosts(this.actor(req), query);
  }

  @Patch('posts/:id')
  @UseGuards(AdminStepUpGuard)
  moderatePost(@Req() req: AdminRequest, @Param('id') id: string, @Body() dto: PostModerationDto) {
    return this.admin.moderatePost(this.actor(req), id, dto, req.requestId);
  }

  @Get('communities')
  communities(@Req() req: AdminRequest, @Query() query: ListQueryDto) {
    return this.admin.listCommunities(this.actor(req), query);
  }

  @Patch('communities/:id')
  @UseGuards(AdminStepUpGuard)
  moderateCommunity(@Req() req: AdminRequest, @Param('id') id: string, @Body() dto: CommunityModerationDto) {
    return this.admin.moderateCommunity(this.actor(req), id, dto, req.requestId);
  }

  @Get('subscriptions')
  subscriptions(@Req() req: AdminRequest, @Query() query: ListQueryDto) {
    return this.admin.listSubscriptions(this.actor(req), query);
  }

  @Post('subscriptions/grant')
  @UseGuards(AdminStepUpGuard)
  grant(@Req() req: AdminRequest, @Body() dto: GrantSubscriptionDto) {
    return this.admin.grantSubscription(this.actor(req), dto, req.requestId);
  }

  @Get('redeem')
  redeem(@Req() req: AdminRequest) {
    return this.admin.listRedeem(this.actor(req));
  }

  @Post('redeem')
  @UseGuards(AdminStepUpGuard)
  createRedeem(@Req() req: AdminRequest, @Body() dto: CreateRedeemDto) {
    return this.admin.createRedeem(this.actor(req), dto, req.requestId);
  }

  @Post('redeem/:id/disable')
  @HttpCode(200)
  @UseGuards(AdminStepUpGuard)
  disableRedeem(@Req() req: AdminRequest, @Param('id') id: string, @Body() dto: RedeemActionDto) {
    return this.admin.disableRedeem(this.actor(req), id, dto.reason, req.requestId);
  }

  @Get('config')
  config(@Req() req: AdminRequest) {
    return this.admin.listConfig(this.actor(req));
  }

  @Put('config')
  @UseGuards(AdminStepUpGuard)
  updateConfig(@Req() req: AdminRequest, @Body() dto: UpdateConfigDto) {
    return this.admin.updateConfig(this.actor(req), dto, req.requestId);
  }

  @Get('audit')
  audit(@Req() req: AdminRequest, @Query() query: AuditQueryDto) {
    return this.admin.auditLogs(this.actor(req), query);
  }

  @Get('jobs')
  jobs(@Req() req: AdminRequest) {
    return this.admin.listJobs(this.actor(req));
  }

  @Post('jobs/retention')
  @HttpCode(200)
  @UseGuards(AdminStepUpGuard)
  retention(@Req() req: AdminRequest) {
    return this.admin.runRetention(this.actor(req), req.requestId);
  }

  @Post('jobs/billing-reconcile')
  @HttpCode(200)
  @UseGuards(AdminStepUpGuard)
  reconcile(@Req() req: AdminRequest) {
    return this.admin.reconcileBilling(this.actor(req), req.requestId);
  }
}
