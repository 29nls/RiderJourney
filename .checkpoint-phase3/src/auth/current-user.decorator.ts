import { createParamDecorator, type ExecutionContext } from '@nestjs/common';
import type { UserRow } from './auth.types.js';

export const CurrentUser = createParamDecorator((_data: unknown, ctx: ExecutionContext): UserRow => {
  return ctx.switchToHttp().getRequest<{ user: UserRow }>().user;
});
