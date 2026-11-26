import { ConflictException, HttpException, HttpStatus, Inject, Injectable, UnauthorizedException } from '@nestjs/common';
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

  /**
   * Account-scoped login throttle. The global throttler only sees one IP, so a
   * distributed guess against one inbox and one IP guessing across many inboxes
   * both slip through it. This counts failures per account instead.
   */
  private async assertNotLocked(emailHash: string): Promise<void> {
    const rows = await this.db.query<{ locked_until: Date | null }>(
      'SELECT locked_until FROM login_throttles WHERE email_hash = $1',
      [emailHash],
    );
    const lockedUntil = rows[0]?.locked_until;
    if (!lockedUntil || new Date(lockedUntil).getTime() <= Date.now()) return;
    const retryAfterSeconds = Math.max(1, Math.ceil((new Date(lockedUntil).getTime() - Date.now()) / 1000));
    throw new HttpException(
      {
        code: 'LOGIN_LOCKED',
        title: 'Login ditahan sementara',
        detail: 'Terlalu banyak percobaan gagal untuk akun ini. Coba lagi nanti atau gunakan pemulihan kata sandi.',
        retryAfterSeconds,
      },
      HttpStatus.TOO_MANY_REQUESTS,
    );
  }

  /**
   * One statement, so concurrent failures cannot each read the old count and
   * write the same increment. The lock is derived from the same expression, which
   * keeps the count and the lock consistent under concurrency.
   */
  private async recordFailedLogin(emailHash: string): Promise<void> {
    const rows = await this.db.query<{ failed_count: number; locked_until: Date | null }>(
      `INSERT INTO login_throttles (email_hash, failed_count, window_started_at)
       VALUES ($1, 1, now())
       ON CONFLICT (email_hash) DO UPDATE SET
         window_started_at = CASE
           WHEN login_throttles.window_started_at < now() - interval '15 minutes' THEN now()
           ELSE login_throttles.window_started_at END,
         failed_count = CASE
           WHEN login_throttles.window_started_at < now() - interval '15 minutes' THEN 1
           ELSE login_throttles.failed_count + 1 END,
         locked_until = CASE
           WHEN (CASE
             WHEN login_throttles.window_started_at < now() - interval '15 minutes' THEN 1
             ELSE login_throttles.failed_count + 1 END) >= 10
           THEN now() + interval '15 minutes'
           ELSE login_throttles.locked_until END,
         updated_at = now()
       RETURNING failed_count, locked_until`,
      [emailHash],
    );
    const lockedUntil = rows[0]?.locked_until;
    if (lockedUntil && new Date(lockedUntil).getTime() > Date.now()) {
      await this.assertNotLocked(emailHash);
    }
  }

  private async clearLoginThrottle(emailHash: string): Promise<void> {
    await this.db.query('DELETE FROM login_throttles WHERE email_hash = $1', [emailHash]);
  }

  async login(emailInput: string, password: string, userAgent?: string): Promise<AuthResult> {
    const email = this.normalizeEmail(emailInput);
    const emailHash = sha256(email);
    await this.assertNotLocked(emailHash);
    const rows = await this.db.query<UserRow>('SELECT * FROM users WHERE lower(email) = $1', [email]);
    const user = rows[0];
    if (!user?.password_hash || !(await bcrypt.compare(password, user.password_hash))) {
      await this.recordFailedLogin(emailHash);
      throw new UnauthorizedException({ code: 'INVALID_CREDENTIALS', title: 'Login gagal', detail: 'Email atau kata sandi salah.' });
    }
    if (user.status !== 'active') {
      throw new UnauthorizedException({ code: 'ACCOUNT_UNAVAILABLE', title: 'Akun tidak tersedia', detail: 'Akun tidak dapat digunakan.' });
    }
    await this.clearLoginThrottle(emailHash);
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

  /**
   * The token is consumed by the same UPDATE that selects it. Checking used_at in
   * application code first would let two concurrent requests both pass the check
   * and both set a password; only the winner of this row update may proceed.
   */
  async confirmPasswordReset(token: string, newPassword: string): Promise<void> {
    const hash = await bcrypt.hash(newPassword, 12);
    await this.db.transaction(async (tx) => {
      const consumed = await tx.query<{ user_id: string }>(
        `UPDATE one_time_tokens SET used_at = now()
         WHERE token_hash = $1 AND kind = 'password_reset'
           AND used_at IS NULL AND expires_at > now()
         RETURNING user_id`,
        [sha256(token)],
      );
      const record = consumed[0];
      if (!record) {
        throw new UnauthorizedException({ code: 'INVALID_RESET_TOKEN', title: 'Token reset tidak valid', detail: 'Token reset tidak valid atau kedaluwarsa.' });
      }
      await tx.query('UPDATE users SET password_hash = $2, updated_at = now() WHERE id = $1', [record.user_id, hash]);
      await tx.query('UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL', [record.user_id]);
    });
  }

  async verifyEmail(token: string): Promise<{ verified: true }> {
    return this.db.transaction(async (tx) => {
      const consumed = await tx.query<{ user_id: string }>(
        `UPDATE one_time_tokens SET used_at = now()
         WHERE token_hash = $1 AND kind = 'email_verify'
           AND used_at IS NULL AND expires_at > now()
         RETURNING user_id`,
        [sha256(token)],
      );
      const record = consumed[0];
      if (!record) {
        throw new UnauthorizedException({ code: 'INVALID_VERIFICATION_TOKEN', title: 'Token verifikasi tidak valid', detail: 'Token verifikasi tidak valid atau kedaluwarsa.' });
      }
      await tx.query('UPDATE users SET email_verified = true, updated_at = now() WHERE id = $1', [record.user_id]);
      return { verified: true as const };
    });
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
