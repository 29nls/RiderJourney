import { Body, Controller, HttpCode, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserRow } from '../auth/auth.types.js';
import { RealtimeTicketDto } from '../convoys/convoys.dto.js';
import { RealtimeService } from './realtime.service.js';

@Controller('v1/realtime')
@UseGuards(AuthGuard)
export class RealtimeController {
  constructor(private readonly realtime: RealtimeService) {}

  @Post('ticket')
  @HttpCode(201)
  issue(@CurrentUser() user: UserRow, @Body() dto: RealtimeTicketDto) {
    return this.realtime.issueTicket(user.id, dto.convoyId);
  }
}
