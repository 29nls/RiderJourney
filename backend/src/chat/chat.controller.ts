import { Body, Controller, Get, HttpCode, Param, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserRow } from '../auth/auth.types.js';
import { MessagePageQueryDto, ReportMessageDto, SendMessageDto } from './chat.dto.js';
import { ChatService } from './chat.service.js';

@Controller('v1')
@UseGuards(AuthGuard)
export class ChatController {
  constructor(private readonly chat: ChatService) {}

  @Get('convoys/:id/messages')
  list(@CurrentUser() user: UserRow, @Param('id') id: string, @Query() query: MessagePageQueryDto) {
    return this.chat.list(user.id, id, query);
  }

  @Post('convoys/:id/messages')
  send(@CurrentUser() user: UserRow, @Param('id') id: string, @Body() dto: SendMessageDto) {
    return this.chat.send(user.id, id, dto);
  }

  @Post('convoys/:id/messages/:messageId/report')
  @HttpCode(201)
  report(
    @CurrentUser() user: UserRow,
    @Param('id') id: string,
    @Param('messageId') messageId: string,
    @Body() dto: ReportMessageDto,
  ) {
    return this.chat.report(user.id, id, messageId, dto);
  }

}
