import { Controller, Get, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { PlaceSearchQueryDto } from './places.dto.js';
import { PlacesService } from './places.service.js';

@Controller('v1/places')
@UseGuards(AuthGuard)
export class PlacesController {
  constructor(private readonly places: PlacesService) {}

  @Get('search')
  search(@Query() query: PlaceSearchQueryDto) {
    return this.places.search(query.q, query.limit ?? 8);
  }
}
