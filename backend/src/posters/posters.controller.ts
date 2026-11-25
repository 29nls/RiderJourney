import { Body, Controller, Get, Header, HttpCode, Param, Post, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserRow } from '../auth/auth.types.js';
import { CreatePosterDto } from './posters.dto.js';
import { PostersService } from './posters.service.js';

@Controller('v1')
@UseGuards(AuthGuard)
export class PostersController {
  constructor(private readonly posters: PostersService) {}

  @Post('trips/:tripId/posters')
  @HttpCode(201)
  create(@CurrentUser() user: UserRow, @Param('tripId') tripId: string, @Body() dto: CreatePosterDto) {
    return this.posters.create(user.id, tripId, dto);
  }

  @Get('trips/:tripId/posters')
  forTrip(@CurrentUser() user: UserRow, @Param('tripId') tripId: string) {
    return this.posters.forTrip(user.id, tripId);
  }

  @Get('posters/:id')
  get(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.posters.get(user.id, id);
  }

  @Get('posters/:id/render.svg')
  @Header('Content-Type', 'image/svg+xml')
  @Header('Cache-Control', 'private, no-store')
  async render(@CurrentUser() user: UserRow, @Param('id') id: string, @Res({ passthrough: true }) res: Response) {
    res.setHeader('Content-Disposition', 'inline; filename="riderjourney-poster.svg"');
    return this.posters.svg(user.id, id);
  }

  @Post('posters/:id/export')
  @HttpCode(200)
  export(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.posters.export(user.id, id);
  }
}
