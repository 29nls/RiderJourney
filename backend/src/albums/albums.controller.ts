import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserRow } from '../auth/auth.types.js';
import {
  AddAlbumMediaDto, AlbumListQueryDto, CreateAlbumDto, ReviewAlbumMediaDto, UpdateAlbumMediaDto,
} from './albums.dto.js';
import { AlbumsService } from './albums.service.js';

@Controller('v1')
@UseGuards(AuthGuard)
export class AlbumsController {
  constructor(private readonly albums: AlbumsService) {}

  @Post('albums')
  @HttpCode(201)
  create(@CurrentUser() user: UserRow, @Body() dto: CreateAlbumDto) {
    return this.albums.create(user.id, dto);
  }

  @Get('albums')
  mine(@CurrentUser() user: UserRow, @Query() query: AlbumListQueryDto) {
    return this.albums.mine(user.id, query);
  }

  @Get('albums/:id')
  get(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.albums.one(user.id, id);
  }

  @Delete('albums/:id')
  @HttpCode(200)
  remove(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.albums.removeAlbum(user.id, id);
  }

  @Post('albums/:id/media')
  @HttpCode(200)
  addMedia(@CurrentUser() user: UserRow, @Param('id') id: string, @Body() dto: AddAlbumMediaDto) {
    return this.albums.addMedia(user.id, id, dto);
  }

  @Patch('albums/:id/media/:mediaId')
  updateMedia(
    @CurrentUser() user: UserRow,
    @Param('id') id: string,
    @Param('mediaId') mediaId: string,
    @Body() dto: UpdateAlbumMediaDto,
  ) {
    return this.albums.updateMedia(user.id, id, mediaId, dto);
  }

  @Delete('albums/:id/media/:mediaId')
  @HttpCode(200)
  removeMedia(@CurrentUser() user: UserRow, @Param('id') id: string, @Param('mediaId') mediaId: string) {
    return this.albums.removeMedia(user.id, id, mediaId);
  }

  @Post('albums/:id/media/:mediaId/review')
  @HttpCode(200)
  review(
    @CurrentUser() user: UserRow,
    @Param('id') id: string,
    @Param('mediaId') mediaId: string,
    @Body() dto: ReviewAlbumMediaDto,
  ) {
    return this.albums.reviewMedia(user.id, id, mediaId, dto);
  }

  @Get('communities/:communityId/albums')
  communityAlbums(
    @CurrentUser() user: UserRow,
    @Param('communityId') communityId: string,
    @Query() query: AlbumListQueryDto,
  ) {
    return this.albums.forCommunity(user.id, communityId, query);
  }
}
