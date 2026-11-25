import { CanActivate, ExecutionContext, ForbiddenException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import type { Request } from 'express';
import { DATABASE, type Database } from '../db/database.js';
import type { UserRow } from '../auth/auth.types.js';
import { AdminStepUpService } from './step-up.service.js';
import type { AdminActor, AdminRole } from './admin.types.js';

export type AdminRequest = Request & {
  user: UserRow;
  admin: AdminActor;
  requestId?: string;
};

@Injectable()
export class AdminGuard implements CanActivate {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    if (!request.user) {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', title: 'Autentikasi diperlukan', detail: 'Token akses tidak ditemukan.' });
    }
    const rows = await this.db.query<{ role: AdminRole; disabled: boolean }>(
      `SELECT role, disabled FROM admin_users WHERE user_id = $1`,
      [request.user.id],
    );
    if (!rows[0] || rows[0].disabled) {
      throw new ForbiddenException({ code: 'ADMIN_FORBIDDEN', title: 'Akses admin ditolak', detail: 'Akun tidak memiliki akses konsol admin.' });
    }
    request.admin = { userId: request.user.id, role: rows[0].role };
    return true;
  }
}

@Injectable()
export class AdminStepUpGuard implements CanActivate {
  constructor(private readonly stepUp: AdminStepUpService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<AdminRequest>();
    const token = request.header('x-step-up-token');
    if (!token) {
      throw new ForbiddenException({
        code: 'STEP_UP_REQUIRED',
        title: 'Verifikasi MFA diperlukan',
        detail: 'Kirim X-Step-Up-Token dari kode authenticator untuk tindakan ini.',
      });
    }
    await this.stepUp.verifyToken(token, request.admin.userId);
    return true;
  }
}
