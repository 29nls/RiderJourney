import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { DATABASE, type Database } from '../db/database.js';
import { TokenService } from './token.service.js';
import type { UserRow } from './auth.types.js';

export type AuthenticatedRequest = Request & { user: UserRow; requestId?: string };

@Injectable()
export class AuthGuard implements CanActivate {
  constructor(
    private readonly tokens: TokenService,
    @Inject(DATABASE) private readonly db: Database,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AuthenticatedRequest>();
    const header = request.header('authorization');
    if (!header?.startsWith('Bearer ')) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', title: 'Autentikasi diperlukan', detail: 'Token akses tidak ditemukan.' });
    }
    const userId = await this.tokens.verifyAccess(header.slice(7));
    const rows = await this.db.query<UserRow>('SELECT * FROM users WHERE id = $1', [userId]);
    const user = rows[0];
    if (!user) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', title: 'Sesi tidak valid', detail: 'Akun tidak ditemukan.' });
    }
    if (user.status !== 'active') {
      throw new ForbiddenException({ code: 'ACCOUNT_UNAVAILABLE', title: 'Akun tidak tersedia', detail: 'Akun sedang dibatasi.' });
    }
    request.user = user;
    return true;
  }
}
