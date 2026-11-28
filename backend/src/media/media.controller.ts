import { Body, Controller, Delete, Get, HttpCode, Param, Post, Query, Res, UseGuards } from '@nestjs/common';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { UuidParamPipe } from '../common/uuid.pipe.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserRow } from '../auth/auth.types.js';
import { CreateUploadDto } from './media.dto.js';
import { MediaService } from './media.service.js';
import { StorageQuotaService } from './storage-quota.js';

/**
 * Signed GET is intentionally unauthenticated: the signature is the capability.
 * It is scoped to one media id and one expiry, so it cannot be replayed against
 * another object or after it lapses. The response includes a short-lived
 * presigned storage URL; the bucket itself is never public.
 */
@Controller('v1/media')
export class MediaAccessController {
  constructor(private readonly media: MediaService) {}

  @Get(':id/access')
  access(
    @Param('id', UuidParamPipe) id: string,
    @Query('expires') expires: string,
    @Query('signature') signature: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    res.setHeader('Cache-Control', 'private, max-age=60');
    res.setHeader('Referrer-Policy', 'no-referrer');
    return this.media.verifySignedAccess(id, expires ?? '', signature ?? '');
  }
}

@Controller('v1/media')
@UseGuards(AuthGuard)
export class MediaController {
  constructor(
    private readonly media: MediaService,
    private readonly quota: StorageQuotaService,
  ) {}

  @Post('uploads')
  @HttpCode(201)
  intent(@CurrentUser() user: UserRow, @Body() dto: CreateUploadDto) {
    return this.media.createIntent(user.id, dto);
  }

  /**
   * No body: size, type, and checksum come from the object the server reads
   * back, not from fields the client could lie about.
   */
  @Post('uploads/:id/complete')
  @HttpCode(200)
  complete(@CurrentUser() user: UserRow, @Param('id', UuidParamPipe) id: string) {
    return this.media.complete(user.id, id);
  }

  /** Mints a short-lived signed GET for a viewer who may see this media. */
  @Get(':id/url')
  signed(@CurrentUser() user: UserRow, @Param('id', UuidParamPipe) id: string) {
    return this.media.signGet(user.id, id);
  }

  /** Returns current storage quota usage for the authenticated user. */
  @Get('quota')
  storageQuota(@CurrentUser() user: UserRow) {
    return this.quota.getQuota(user.id);
  }

  /**
   * Deletion marks the row 'deleting' and enqueues the object; the quota only
   * shrinks once the worker has confirmed the bytes are gone. A media still
   * referenced by a post, album, trip, poster, hazard, avatar, or vehicle
   * answers 409 MEDIA_IN_USE instead of being removed.
   */
  @Delete(':id')
  @HttpCode(200)
  remove(@CurrentUser() user: UserRow, @Param('id', UuidParamPipe) id: string) {
    return this.media.requestDeletion(user.id, id);
  }

  /**
   * Cancellation is only honest before the worker claims the job. Afterwards
   * the object may already be gone, so the answer is a conflict, not a promise.
   */
  @Post(':id/cancel-deletion')
  @HttpCode(200)
  cancelDeletion(@CurrentUser() user: UserRow, @Param('id', UuidParamPipe) id: string) {
    return this.media.cancelDeletion(user.id, id);
  }
}
