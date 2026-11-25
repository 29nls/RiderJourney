import { Body, Controller, Get, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserRow } from '../auth/auth.types.js';
import { RoutePreviewDto } from './routes.dto.js';
import { RoutesService } from './routes.service.js';

@Controller('v1/routes')
@UseGuards(AuthGuard)
export class RoutesController {
  constructor(private readonly routes: RoutesService) {}

  @Post('preview')
  preview(@CurrentUser() user: UserRow, @Body() dto: RoutePreviewDto) {
    return this.routes.preview(user.id, dto);
  }

  @Get(':id')
  get(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.routes.get(id, user.id);
  }
}
