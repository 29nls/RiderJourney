import { Body, Controller, Get, Patch, Post, UseGuards } from '@nestjs/common';
import { AuthGuard } from '../auth/auth.guard.js';
import { CurrentUser } from '../auth/current-user.decorator.js';
import type { UserRow } from '../auth/auth.types.js';
import { ConsentDto, UpdateProfileDto, UpdateSettingsDto } from './users.dto.js';
import { UsersService } from './users.service.js';

@Controller('v1/me')
@UseGuards(AuthGuard)
export class UsersController {
  constructor(private readonly users: UsersService) {}

  @Get()
  me(@CurrentUser() user: UserRow) {
    return this.users.me(user.id);
  }

  @Patch()
  update(@CurrentUser() user: UserRow, @Body() dto: UpdateProfileDto) {
    return this.users.updateProfile(user.id, dto);
  }

  @Get('settings')
  settings(@CurrentUser() user: UserRow) {
    return this.users.settings(user.id);
  }

  @Patch('settings')
  updateSettings(@CurrentUser() user: UserRow, @Body() dto: UpdateSettingsDto) {
    return this.users.updateSettings(user.id, dto);
  }

  @Post('consents')
  consent(@CurrentUser() user: UserRow, @Body() dto: ConsentDto) {
    return this.users.addConsent(user.id, dto);
  }
}
