import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { UuidParamPipe } from '../common/uuid.pipe.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserRow } from '../auth/auth.types.js';
import { ConfirmHazardDto, CreateHazardDto, NearbyQueryDto, ReportHazardDto } from './hazards.dto.js';
import { HazardsService } from './hazards.service.js';

@Controller('v1/hazards')
@UseGuards(AuthGuard)
export class HazardsController {
  constructor(private readonly hazards: HazardsService) {}

  @Get('nearby')
  nearby(@Query() query: NearbyQueryDto) {
    return this.hazards.nearby(query);
  }

  @Post()
  create(@CurrentUser() user: UserRow, @Body() dto: CreateHazardDto) {
    return this.hazards.create(user.id, dto);
  }

  @Post(':id/confirm')
  @HttpCode(200)
  confirm(@CurrentUser() user: UserRow, @Param('id', UuidParamPipe) id: string, @Body() dto: ConfirmHazardDto) {
    return this.hazards.confirm(user.id, id, dto);
  }

  @Post(':id/report')
  @HttpCode(201)
  report(@CurrentUser() user: UserRow, @Param('id', UuidParamPipe) id: string, @Body() dto: ReportHazardDto) {
    return this.hazards.report(user.id, id, dto);
  }
}
