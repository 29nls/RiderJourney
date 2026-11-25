import { Inject, Injectable, UnauthorizedException } from '@nestjs/common';
import { SignJWT, jwtVerify } from 'jose';
import { v7 as uuidv7 } from 'uuid';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import { DATABASE, type Database } from '../db/database.js';
import { randomToken, sha256 } from '../common/crypto.js';
import { ACCESS_TOKEN_AUDIENCE, ACCESS_TOKEN_ISSUER } from './auth.types.js';

export type IssuedTokens = { accessToken: string; refreshToken: string; expiresIn: number };
type IssuedTokensWithId = IssuedTokens & { refreshTokenId: string };

@Injectable()
export class TokenService {
  private readonly key: Uint8Array;
  constructor(
    @Inject(APP_CONFIG) private readonly config: AppConfig,
    @Inject(DATABASE) private readonly db: Database,
  ) {
    this.key = new TextEncoder().encode(config.jwtSecret);
  }

  async issue(userId: string, userAgent?: string): Promise<IssuedTokens> {
    const { refreshTokenId: _refreshTokenId, ...tokens } = await this.issueOn(this.db, userId, userAgent);
    return tokens;
  }

  private async issueOn(db: Database, userId: string, userAgent?: string): Promise<IssuedTokensWithId> {
    const accessToken = await new SignJWT({ typ: 'access' })
      .setProtectedHeader({ alg: 'HS256' })
      .setSubject(userId)
      .setIssuer(ACCESS_TOKEN_ISSUER)
      .setAudience(ACCESS_TOKEN_AUDIENCE)
      .setIssuedAt()
      .setExpirationTime(`${this.config.accessTtlSeconds}s`)
      .sign(this.key);

    const refreshToken = randomToken(48);
    const refreshTokenId = uuidv7();
    const expiresAt = new Date(Date.now() + this.config.refreshTtlDays * 86_400_000);
    await db.query(
      `INSERT INTO refresh_tokens (id, user_id, token_hash, expires_at, user_agent)
       VALUES ($1, $2, $3, $4, $5)`,
      [refreshTokenId, userId, sha256(refreshToken), expiresAt, userAgent?.slice(0, 300) ?? null],
    );
    return { accessToken, refreshToken, expiresIn: this.config.accessTtlSeconds, refreshTokenId };
  }

  async verifyAccess(token: string): Promise<string> {
    try {
      const { payload } = await jwtVerify(token, this.key, {
        issuer: ACCESS_TOKEN_ISSUER,
        audience: ACCESS_TOKEN_AUDIENCE,
        algorithms: ['HS256'],
      });
      if (!payload.sub) throw new Error('missing subject');
      return payload.sub;
    } catch {
      throw new UnauthorizedException({ code: 'UNAUTHENTICATED', title: 'Sesi tidak valid', detail: 'Token akses tidak valid atau kedaluwarsa.' });
    }
  }

  async rotate(refreshToken: string, userAgent?: string): Promise<IssuedTokens> {
    return this.db.transaction(async (tx) => {
      const rows = await tx.query<{ id: string; user_id: string; expires_at: Date; revoked_at: Date | null }>(
        `SELECT id, user_id, expires_at, revoked_at
         FROM refresh_tokens WHERE token_hash = $1
         FOR UPDATE`,
        [sha256(refreshToken)],
      );
      const row = rows[0];
      if (!row || row.revoked_at || new Date(row.expires_at).getTime() <= Date.now()) {
        throw new UnauthorizedException({ code: 'INVALID_REFRESH_TOKEN', title: 'Sesi tidak valid', detail: 'Refresh token tidak valid atau sudah dicabut.' });
      }
      const issued = await this.issueOn(tx, row.user_id, userAgent);
      const revoked = await tx.query<{ id: string }>(
        `UPDATE refresh_tokens SET revoked_at = now(), replaced_by = $2
         WHERE id = $1 AND revoked_at IS NULL
         RETURNING id`,
        [row.id, issued.refreshTokenId],
      );
      if (revoked.length === 0) {
        throw new UnauthorizedException({ code: 'INVALID_REFRESH_TOKEN', title: 'Sesi tidak valid', detail: 'Refresh token tidak valid atau sudah dicabut.' });
      }
      const { refreshTokenId: _refreshTokenId, ...tokens } = issued;
      return tokens;
    });
  }

  async revoke(refreshToken: string): Promise<void> {
    await this.db.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE token_hash = $1 AND revoked_at IS NULL`, [
      sha256(refreshToken),
    ]);
  }

  async revokeAll(userId: string): Promise<void> {
    await this.db.query(`UPDATE refresh_tokens SET revoked_at = now() WHERE user_id = $1 AND revoked_at IS NULL`, [userId]);
  }
}
