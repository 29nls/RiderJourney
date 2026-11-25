import { Body, Controller, Delete, Get, HttpCode, Param, Patch, Post, Query, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserRow } from '../auth/auth.types.js';
import {
  NotificationListQueryDto,
  RegisterPushDeviceDto,
  UpdateNotificationPreferencesDto,
} from './notifications.dto.js';
import { NotificationsService } from './notifications.service.js';

@Controller('v1')
@UseGuards(AuthGuard)
export class NotificationsController {
  constructor(private readonly notifications: NotificationsService) {}

  @Get('notifications')
  list(@CurrentUser() user: UserRow, @Query() query: NotificationListQueryDto) {
    const unread = query.unread === undefined ? undefined : query.unread === 'true';
    return this.notifications.list(user.id, unread, query.limit ?? 20, query.cursor);
  }

  @Post('notifications/read-all')
  @HttpCode(200)
  readAll(@CurrentUser() user: UserRow) {
    return this.notifications.markAllRead(user.id);
  }

  @Post('notifications/:id/read')
  @HttpCode(200)
  read(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.notifications.markRead(user.id, id);
  }

  @Get('me/notification-preferences')
  preferences(@CurrentUser() user: UserRow) {
    return this.notifications.preferences(user.id);
  }

  @Patch('me/notification-preferences')
  updatePreferences(@CurrentUser() user: UserRow, @Body() dto: UpdateNotificationPreferencesDto) {
    return this.notifications.updatePreferences(user.id, dto);
  }

  @Post('me/push-devices')
  @HttpCode(201)
  register(@CurrentUser() user: UserRow, @Body() dto: RegisterPushDeviceDto) {
    return this.notifications.registerDevice(user.id, dto);
  }

  @Delete('me/push-devices/:id')
  @HttpCode(200)
  remove(@CurrentUser() user: UserRow, @Param('id') id: string) {
    return this.notifications.removeDevice(user.id, id);
  }
}
