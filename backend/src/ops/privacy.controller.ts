import { Body, Controller, Delete, Get, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { IsOptional, IsString, Length } from 'class-validator';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserRow } from '../auth/auth.types.js';
import { PrivacyService } from './privacy.service.js';

class DeletionRequestDto {
  @IsString()
  @Length(3, 20)
  confirmation!: string;

  @IsOptional()
  @IsString()
  @Length(1, 300)
  reason?: string;
}

@Controller('v1/privacy')
@UseGuards(AuthGuard)
export class PrivacyController {
  constructor(private readonly privacy: PrivacyService) {}

  @Post('export')
  @Throttle({ default: { limit: 3, ttl: 60_000 } })
  requestExport(@CurrentUser() user: UserRow) {
    return this.privacy.requestExport(user.id);
  }

  @Get('export')
  exports(@CurrentUser() user: UserRow) {
    return this.privacy.exportJobs(user.id);
  }

  @Get('export/:id')
  download(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.privacy.download(user.id, id);
  }

  @Post('deletion')
  @Throttle({ default: { limit: 3, ttl: 3_600_000 } })
  requestDeletion(@CurrentUser() user: UserRow, @Body() dto: DeletionRequestDto) {
    return this.privacy.requestDeletion(user.id, dto.confirmation, dto.reason);
  }

  @Get('deletion')
  deletion(@CurrentUser() user: UserRow) {
    return this.privacy.deletionStatus(user.id);
  }

  @Delete('deletion/:id')
  @HttpCode(200)
  cancel(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.privacy.cancelDeletion(user.id, id);
  }
}
