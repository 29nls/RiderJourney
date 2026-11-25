import { ConflictException, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import bcrypt from 'bcryptjs';
import { v7 as uuidv7 } from 'uuid';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.js';
import { randomToken, sha256 } from '../common/crypto.js';
import { toPublicUser, type PublicUser, type UserRow } from './auth.types.js';
import { TokenService, type IssuedTokens } from './token.service.js';

export type AuthResult = IssuedTokens & { user: PublicUser; verificationToken?: string };

@Injectable()
export class AuthService {
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
    private readonly tokens: TokenService,
  ) {}

  private normalizeEmail(email: string): string {
    return email.trim().toLowerCase();
  }

  private async findById(id: string): Promise<UserRow | undefined> {
    const rows = await this.db.query<UserRow>('SELECT * FROM users WHERE id = $1', [id]);
    return rows[0];
  }

  private async createOneTimeToken(userId: string, kind: 'email_verify' | 'password_reset'): Promise<string | undefined> {
    const raw = randomToken(32);
    const expiresAt = new Date(Date.now() + (kind === 'password_reset' ? 30 : 60) * 60_000);
    await this.db.query(
      `INSERT INTO one_time_tokens (id, user_id, kind, token_hash, expires_at) VALUES ($1, $2, $3, $4, $5)`,
      [uuidv7(), userId, kind, sha256(raw), expiresAt],
    );
    return this.config.exposeDevTokens ? raw : undefined;
  }

  async register(input: { email: string; username: string; displayName: string; password: string }, userAgent?: string): Promise<AuthResult> {
    const email = this.normalizeEmail(input.email);
    const username = input.username.trim().toLowerCase();
    const existing = await this.db.query<{ email: string; username: string }>(
      'SELECT email, username FROM users WHERE lower(email) = $1 OR lower(username) = $2',
      [email, username],
    );
    if (existing.length > 0) {
      const conflict = existing[0].email.toLowerCase() === email ? 'EMAIL_TAKEN' : 'USERNAME_TAKEN';
      throw new ConflictException({
        code: conflict,
        title: 'Akun sudah ada',
        detail: conflict === 'EMAIL_TAKEN' ? 'Email sudah terdaftar.' : 'Username sudah dipakai.',
      });
    }

    const id = uuidv7();
    const passwordHash = await bcrypt.hash(input.password, 12);
    await this.db.transaction(async (tx) => {
      await tx.query(
        `INSERT INTO users (id, email, username, password_hash, display_name)
         VALUES ($1, $2, $3, $4, $5)`,
        [id, email, username, passwordHash, input.displayName.trim()],
      );
      await tx.query('INSERT INTO user_settings (user_id) VALUES ($1)', [id]);
    });

    const user = (await this.findById(id))!;
    const issued = await this.tokens.issue(id, userAgent);
    const verificationToken = await this.createOneTimeToken(id, 'email_verify');
    return { ...issued, user: toPublicUser(user), ...(verificationToken ? { verificationToken } : {}) };
  }

  async login(emailInput: string, password: string, userAgent?: string): Promise<AuthResult> {
    const email = this.normalizeEmail(emailInput);
    const rows = await this.db.query<UserRow>('SELECT * FROM users WHERE lower(email) = $1', [email]);
    const user = rows[0];
    if (!user?.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', title: 'Login gagal', detail: 'Email atau kata sandi salah.' });
    }
    if (user.status !== 'active') {
      throw new UnauthorizedException({ code: 'ACCOUNT_UNAVAILABLE', title: 'Akun tidak tersedia', detail: 'Akun tidak dapat digunakan.' });
    }
    const issued = await this.tokens.issue(user.id, userAgent);
    return { ...issued, user: toPublicUser(user) };
  }

  async refresh(refreshToken: string, userAgent?: string): Promise<IssuedTokens> {
    return this.tokens.rotate(refreshToken, userAgent);
  }

  async logout(refreshToken: string): Promise<void> {
    await this.tokens.revoke(refreshToken);
  }

  async requestPasswordReset(emailInput: string): Promise<{ accepted: true; devToken?: string }> {
    const email = this.normalizeEmail(emailInput);
    const rows = await this.db.query<UserRow>('SELECT * FROM users WHERE lower(email) = $1 AND status = $2', [email, 'active']);
    const user = rows[0];
    if (!user) return { accepted: true };
    const token = await this.createOneTimeToken(user.id, 'password_reset');
    return { accepted: true, ...(token ? { devToken: token } : {}) };
  }

  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    const rows = await this.db.query<{ id: string; user_id: string; expires_at: Date; used_at: Date | null }>(
      `SELECT id, user_id, expires_at, used_at FROM one_time_tokens
       WHERE token_hash = $1 AND kind = 'password_reset'`,
      [sha256(token)],
    );
    const record = rows[0];
    if (!record || record.used_at || new Date(record.expires_at).getTime() <= Date.now()) {
      throw new UnauthorizedException({ code: 'INVALID_RESET_TOKEN', title: 'Token reset tidak valid', detail: 'Token reset tidak valid atau kedaluwarsa.' });
    }
    const hash = await bcrypt.hash(newPassword, 12);
    await this.db.transaction(async (tx) => {
      await tx.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [record.user_id, hash]);
      await tx.query('UPDATE one_time_tokens SET used_at = now() WHERE id = $1', [record.id]);
      await tx.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [record.user_id]);
    });
  }

  async verifyEmail(token: string): Promise<{ verified: true }> {
    const rows = await this.db.query<{ id: string; user_id: string; expires_at: Date; used_at: Date | null }>(
      `SELECT id, user_id, expires_at, used_at FROM one_time_tokens
       WHERE token_hash = $1 AND kind = 'email_verify'`,
      [sha256(token)],
    );
    const record = rows[0];
    if (!record || record.used_at || new Date(record.expires_at).getTime() <= Date.now()) {
      throw new UnauthorizedException({ code: 'INVALID_VERIFICATION_TOKEN', title: 'Token verifikasi tidak valid', detail: 'Token verifikasi tidak valid atau kedaluwarsa.' });
    }
    await this.db.transaction(async (tx) => {
      await tx.query('UPDATE users SET email_verified = true, updated_at = now() WHERE id = $1', [record.user_id]);
      await tx.query('UPDATE one_time_tokens SET used_at = now() WHERE id = $1', [record.id]);
    });
    return { verified: true };
  }

  async session(userId: string): Promise<PublicUser & { activeTripId: string | null }> {
    const user = await this.findById(userId);
    if (!user || user.status !== 'active') {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', title: 'Sesi tidak valid', detail: 'Akun tidak ditemukan atau tidak aktif.' });
    }
    const active = await this.db.query<{ id: string }>(
      `SELECT id FROM trips WHERE user_id = $1 AND status IN ('active', 'paused') LIMIT 1`,
      [userId],
    );
    return { ...toPublicUser(user), activeTripId: active[0]?.id ?? null };
  }

  async userRow(userId: string): Promise<UserRow> {
    const user = await this.findById(userId);
    if (!user) throw new UnauthorizedException({ code: 'UNAUTHENTICATED', title: 'Sesi tidak valid', detail: 'Akun tidak ditemukan.' });
    return user;
  }
}
