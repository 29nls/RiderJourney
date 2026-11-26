import {
  BadRequestException,
  Body,
  Controller,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
  Res,
  UploadedFile,
  UseGuards,
  UseInterceptors,
} from '@nestjs/common';
import { FileInterceptor } from '@nestjs/platform-express';
import type { Response } from 'express';
import { AuthGuard } from '../auth/auth.guard.js';
import { UuidParamPipe } from '../common/uuid.pipe.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserRow } from '../auth/auth.types.js';
import { CompleteUploadDto, CreateUploadDto } from './media.dto.js';
import { MediaService } from './media.service.js';

// Only the header is needed to check the magic bytes; the object itself is
// streamed to storage, so this endpoint refuses anything larger.
const SNIFF_LIMIT = 1024;

/**
 * Signed GET is intentionally unauthenticated: the signature is the capability.
 * It is scoped to one media id and one expiry, so it cannot be replayed against
 * another object or after it lapses.
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
  constructor(private readonly media: MediaService) {}

  @Post('uploads')
  @HttpCode(201)
  intent(@CurrentUser() user: UserRow, @Body() dto: CreateUploadDto) {
    return this.media.createIntent(user.id, dto);
  }

  @Post('uploads/:id/complete')
  @HttpCode(200)
  @UseInterceptors(FileInterceptor('file', { limits: { fileSize: SNIFF_LIMIT } }))
  complete(
    @CurrentUser() user: UserRow,
    @Param('id', UuidParamPipe) id: string,
    @Body() dto: CompleteUploadDto,
    @UploadedFile() file?: { buffer?: Buffer; size?: number },
  ) {
    if (!file?.buffer || file.buffer.length < 8) {
      throw new BadRequestException({ code: 'MEDIA_BODY_REQUIRED', title: 'Isi media wajib dikirim', detail: 'Sertakan potongan awal file minimal 8 byte.' });
    }
    return this.media.complete(user.id, id, dto.sizeBytes, file.buffer);
  }

  /** Mints a short-lived signed GET for a viewer who may see this media. */
  @Get(':id/url')
  signed(@CurrentUser() user: UserRow, @Param('id', UuidParamPipe) id: string) {
    return this.media.signGet(user.id, id);
  }
}
