import { BadRequestException, Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DATABASE, type Database } from '../db/database.js';
import type { AdminRole } from './admin.types.js';

const ROLES: AdminRole[] = ['support', 'moderator', 'admin', 'superadmin'];

@Injectable()
export class AdminBootstrapService {
  constructor(@Inject(DATABASE) private readonly db: Database) {}

  async grant(email: string, role: AdminRole) {
    if (!ROLES.includes(role)) throw new BadRequestException('Role admin tidak dikenal.');
    const rows = await this.db.query<{ id: string }>(`SELECT id FROM users WHERE lower(email) = lower($1)`, [email]);
    if (!rows[0]) throw new NotFoundException('Pengguna dengan email tersebut tidak ditemukan. Daftarkan akun terlebih dahulu.');
    await this.db.query(
      `INSERT INTO admin_users (user_id, role) VALUES ($1, $2)
       ON CONFLICT (user_id) DO UPDATE SET role = EXCLUDED.role, disabled = false, updated_at = now()`,
      [rows[0].id, role],
    );
    return { userId: rows[0].id, email, role, note: 'MFA belum aktif. Login dan daftarkan authenticator sebelum tindakan sensitif.' };
  }

  async disable(email: string) {
    const rows = await this.db.query<{ id: string }>(
      `UPDATE admin_users SET disabled = true, updated_at = now()
       WHERE user_id = (SELECT id FROM users WHERE lower(email) = lower($1)) RETURNING user_id AS id`,
      [email],
    );
    if (!rows[0]) throw new NotFoundException('Admin tidak ditemukan.');
    return { userId: rows[0].id, disabled: true };
  }
}
