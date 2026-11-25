import { Controller, HttpCode, Param, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserRow } from '../auth/auth.types.js';
import { VoiceService } from './voice.service.js';

@Controller('v1/convoys/:id/voice')
@UseGuards(AuthGuard)
export class VoiceController {
  constructor(private readonly voice: VoiceService) {}

  @Post('token')
  @HttpCode(200)
  token(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.voice.token(user.id, id);
  }

  @Post('leave')
  @HttpCode(200)
  leave(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.voice.leave(user.id, id);
  }
}
