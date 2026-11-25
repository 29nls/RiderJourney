import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserRow } from '../auth/auth.types.js';
import { CreateVehicleDto, UpdateVehicleDto } from './vehicles.dto.js';
import { VehiclesService } from './vehicles.service.js';

@Controller('v1/vehicles')
@UseGuards(AuthGuard)
export class VehiclesController {
  constructor(private readonly vehicles: VehiclesService) {}

  @Get()
  list(@CurrentUser() user: UserRow) {
    return this.vehicles.list(user.id);
  }

  @Post()
  create(@CurrentUser() user: UserRow, @Body() dto: CreateVehicleDto) {
    return this.vehicles.create(user.id, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: UserRow, @Param('id') id: string, @Query('includePlate') includePlate?: string) {
    return this.vehicles.get(user.id, id, includePlate === 'true');
  }

  @Patch(':id')
  update(@CurrentUser() user: UserRow, @Param('id') id: string, @Body() dto: UpdateVehicleDto) {
    return this.vehicles.update(user.id, id, dto);
  }

  @Delete(':id')
  @HttpCode(204)
  async remove(@CurrentUser() user: UserRow, @Param('id') id: string): Promise<void> {
    await this.vehicles.remove(user.id, id);
  }

  @Post(':id/primary')
  @HttpCode(200)
  primary(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.vehicles.setPrimary(user.id, id);
  }
}
