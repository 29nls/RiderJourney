import { Inject, Injectable, NotFoundException, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { decryptValue, encryptValue } from '../common/crypto.js';
import { DATABASE, type Database } from '../db/database.js';
import { ACCESS_TOKEN_ISSUER } from '../auth/auth.types.js';
import { generateTotpSecret, verifyTotp } from './totp.js';

const STEP_UP_AUDIENCE = 'riderjourney-admin-stepup';

@Injectable()
export class AdminStepUpService {
  private readonly key: Uint8Array;

  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
  ) {
    this.key = new TextEncoder().encode(config.jwtSecret);
  }

  private seal(secret: string): string {
    if (!this.config.contactKey) {
      throw new ServiceUnavailableException({
        code: 'ADMIN_MFA_KEY_MISSING',
        title: 'Penyimpanan MFA belum dikonfigurasi',
        detail: 'CONTACT_ENCRYPTION_KEY atau PLATE_ENCRYPTION_KEY diperlukan.',
      });
    }
    const sealed = encryptValue(secret, this.config.contactKey);
    return JSON.stringify({
      v: sealed.keyVersion,
      iv: sealed.iv.toString('base64url'),
      tag: sealed.tag.toString('base64url'),
      ct: sealed.ciphertext.toString('base64url'),
    });
  }

  private open(sealed: string): string | null {
    if (!this.config.contactKey) return null;
    try {
      const parts = JSON.parse(sealed) as { iv: string; tag: string; ct: string };
      return decryptValue(
        {
          iv: Buffer.from(parts.iv, 'base64url'),
          tag: Buffer.from(parts.tag, 'base64url'),
          ciphertext: Buffer.from(parts.ct, 'base64url'),
          keyVersion: 1,
        },
        this.config.contactKey,
      );
    } catch {
      return null;
    }
  }

  async status(adminUserId: string) {
    const rows = await this.db.query<{ mfa_enrolled_at: Date | null }>(
      `SELECT mfa_enrolled_at FROM admin_users WHERE user_id = $1`,
      [adminUserId],
    );
    if (!rows[0]) throw new NotFoundException({ code: 'ADMIN_NOT_FOUND', title: 'Admin tidak ditemukan', detail: 'Akun bukan admin.' });
    return { enrolled: rows[0].mfa_enrolled_at !== null, stepUpTtlSeconds: this.config.adminStepUpTtlSeconds };
  }

  async enroll(adminUserId: string) {
    const rows = await this.db.query<{ username: string }>(
      `SELECT u.username FROM admin_users a JOIN users u ON u.id = a.user_id WHERE a.user_id = $1 AND NOT a.disabled`,
      [adminUserId],
    );
    if (!rows[0]) throw new NotFoundException({ code: 'ADMIN_NOT_FOUND', title: 'Admin tidak ditemukan', detail: 'Akun bukan admin aktif.' });
    const secret = generateTotpSecret();
    await this.db.query(`UPDATE admin_users SET mfa_secret_encrypted = $2, mfa_enrolled_at = NULL, updated_at = now() WHERE user_id = $1`, [
      adminUserId,
      this.seal(secret),
    ]);
    const issuer = encodeURIComponent('RiderJourney Admin');
    const label = encodeURIComponent(`RiderJourney Admin:${rows[0].username}`);
    return {
      secret,
      otpauthUri: `otpauth://totp/${label}?secret=${secret}&issuer=${issuer}&period=30&digits=6`,
      note: 'Scan once, then confirm a code. The secret is encrypted at rest and never returned again.',
    };
  }

  private async secretFor(adminUserId: string): Promise<{ secret: string; enrolled: boolean }> {
    const rows = await this.db.query<{ mfa_secret_encrypted: string | null; mfa_enrolled_at: Date | null }>(
      `SELECT mfa_secret_encrypted, mfa_enrolled_at FROM admin_users WHERE user_id = $1 AND NOT disabled`,
      [adminUserId],
    );
    if (!rows[0]) throw new NotFoundException({ code: 'ADMIN_NOT_FOUND', title: 'Admin tidak ditemukan', detail: 'Akun bukan admin aktif.' });
    const secret = rows[0].mfa_secret_encrypted ? this.open(rows[0].mfa_secret_encrypted) : null;
    if (!secret) throw new UnauthorizedException({ code: 'MFA_NOT_ENROLLED', title: 'MFA belum aktif', detail: 'Daftarkan authenticator terlebih dahulu.' });
    return { secret, enrolled: rows[0].mfa_enrolled_at !== null };
  }

  async confirm(adminUserId: string, code: string) {
    const { secret } = await this.secretFor(adminUserId);
    if (!verifyTotp(secret, code)) {
      throw new UnauthorizedException({ code: 'MFA_CODE_INVALID', title: 'Kode MFA salah', detail: 'Masukkan kode authenticator yang berlaku.' });
    }
    await this.db.query(`UPDATE admin_users SET mfa_enrolled_at = now(), updated_at = now() WHERE user_id = $1`, [adminUserId]);
    return { enrolled: true };
  }

  async stepUp(adminUserId: string, code: string) {
    const { secret, enrolled } = await this.secretFor(adminUserId);
    if (!enrolled) {
      throw new UnauthorizedException({ code: 'MFA_NOT_CONFIRMED', title: 'MFA belum dikonfirmasi', detail: 'Konfirmasi kode pertama sebelum step-up.' });
    }
    if (!verifyTotp(secret, code)) {
      throw new UnauthorizedException({ code: 'MFA_CODE_INVALID', title: 'Kode MFA salah', detail: 'Masukkan kode authenticator yang berlaku.' });
    }
    const token = await new SignJWT({ typ: 'step_up' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(adminUserId)
      .setIssuer(ACCESS_TOKEN_ISSUER)
      .setAudience(STEP_UP_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.config.adminStepUpTtlSeconds}s`)
      .sign(this.key);
    return { stepUpToken: token, expiresIn: this.config.adminStepUpTtlSeconds };
  }

  async verifyToken(token: string, adminUserId: string): Promise<void> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ACCESS_TOKEN_ISSUER,
        audience: STEP_UP_AUDIENCE,
        algorithms: ['HS256'],
      });
      if (payload.typ !== 'step_up' || payload.sub !== adminUserId) throw new Error('wrong subject');
    } catch {
      throw new UnauthorizedException({
        code: 'STEP_UP_INVALID',
        title: 'Step-up tidak valid',
        detail: 'Kirim ulang kode MFA untuk tindakan sensitif ini.',
      });
    }
  }
}
