import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserRow } from '../auth/auth.types.js';
import { StartTripDto, TripListQueryDto, TripPointsDto, TripPointsQueryDto } from './trips.dto.js';
import { TripsService } from './trips.service.js';

@Controller('v1/trips')
@UseGuards(AuthGuard)
export class TripsController {
  constructor(private readonly trips: TripsService) {}

  @Get()
  list(@CurrentUser() user: UserRow, @Query() query: TripListQueryDto) {
    return this.trips.list(user.id, query.limit ?? 20, query.cursor);
  }

  @Get('active')
  active(@CurrentUser() user: UserRow) {
    return this.trips.active(user.id);
  }

  @Post()
  start(@CurrentUser() user: UserRow, @Body() dto: StartTripDto) {
    return this.trips.start(user.id, dto.vehicleId, dto.routeId);
  }

  @Get(':id')
  get(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.trips.get(user.id, id);
  }

  @Post(':id/pause')
  @HttpCode(200)
  pause(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.trips.pause(user.id, id);
  }

  @Post(':id/resume')
  @HttpCode(200)
  resume(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.trips.resume(user.id, id);
  }

  @Post(':id/finish')
  @HttpCode(200)
  finish(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.trips.finish(user.id, id);
  }

  @Post(':id/points')
  @HttpCode(200)
  addPoints(@CurrentUser() user: UserRow, @Param('id') id: string, @Body() dto: TripPointsDto) {
    return this.trips.addPoints(user.id, id, dto);
  }

  @Get(':id/points')
  points(@CurrentUser() user: UserRow, @Param('id') id: string, @Query() query: TripPointsQueryDto) {
    return this.trips.points(user.id, id, query.limit ?? 200, query.cursor);
  }
}
