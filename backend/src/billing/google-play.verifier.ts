import { Inject, Injectable, ServiceUnavailableException, UnauthorizedException } from '@nestjs/common';
import { createSign } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { APP_CONFIG, type AppConfig } from '../config/env.js';
import type { PurchaseVerifier, VerifiedPurchase, VerifiedState, VerifyInput } from './billing.types.js';

type ServiceAccount = { client_email: string; private_key: string; token_uri?: string };

const STATE_MAP: Record<string, VerifiedState> = {
  SUBSCRIPTION_STATE_ACTIVE: 'active',
  SUBSCRIPTION_STATE_IN_GRACE_PERIOD: 'in_grace',
  SUBSCRIPTION_STATE_CANCELED: 'canceled',
  SUBSCRIPTION_STATE_EXPIRED: 'expired',
  SUBSCRIPTION_STATE_PAUSED: 'paused',
  SUBSCRIPTION_STATE_ON_HOLD: 'on_hold',
  SUBSCRIPTION_STATE_PENDING: 'pending',
  SUBSCRIPTION_STATE_PENDING_PURCHASE_CANCELED: 'expired',
};

function base64url(value: string | Buffer): string {
  return Buffer.from(value).toString('base64url');
}

@Injectable()
export class GooglePlayVerifier implements PurchaseVerifier {
  readonly name = 'google_play';
  private cachedToken: { value: string; expiresAt: number } | null = null;

  constructor(@Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private assertConfigured(): void {
    if (!this.config.googlePlayPackageName) {
      throw new ServiceUnavailableException({
        code: 'BILLING_NOT_CONFIGURED',
        title: 'Verifikasi pembelian belum dikonfigurasi',
        detail: 'GOOGLE_PLAY_PACKAGE_NAME dan kredensial service account diperlukan.',
      });
    }
  }

  private async serviceAccount(): Promise<ServiceAccount> {
    const raw = this.config.googlePlayServiceAccountJson;
    if (!raw) {
      throw new ServiceUnavailableException({
        code: 'BILLING_NOT_CONFIGURED',
        title: 'Kredensial Google Play belum ada',
        detail: 'GOOGLE_PLAY_SERVICE_ACCOUNT_JSON diperlukan untuk verifikasi server.',
      });
    }
    const text = raw.trim().startsWith('{') ? raw : await readFile(raw, 'utf8');
    const parsed = JSON.parse(text) as ServiceAccount;
    if (!parsed.client_email || !parsed.private_key) {
      throw new ServiceUnavailableException({
        code: 'BILLING_NOT_CONFIGURED',
        title: 'Kredensial Google Play tidak valid',
        detail: 'Service account harus memuat client_email dan private_key.',
      });
    }
    return parsed;
  }

  private async accessToken(): Promise<string> {
    if (this.config.googlePlayAccessToken) return this.config.googlePlayAccessToken;
    if (this.cachedToken && this.cachedToken.expiresAt > Date.now() + 60_000) return this.cachedToken.value;
    const account = await this.serviceAccount();
    const now = Math.floor(Date.now() / 1000);
    const tokenUri = account.token_uri ?? 'https://oauth2.googleapis.com/token';
    const header = base64url(JSON.stringify({ alg: 'RS256', typ: 'JWT' }));
    const claim = base64url(JSON.stringify({
      iss: account.client_email,
      scope: 'https://www.googleapis.com/auth/androidpublisher',
      aud: tokenUri,
      iat: now,
      exp: now + 3600,
    }));
    const signer = createSign('RSA-SHA256');
    signer.update(`${header}.${claim}`);
    const signature = signer.sign(account.private_key).toString('base64url');
    const assertion = `${header}.${claim}.${signature}`;
    const response = await fetch(tokenUri, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({ grant_type: 'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new UnauthorizedException({
        code: 'BILLING_AUTH_FAILED',
        title: 'Autentikasi provider gagal',
        detail: `Google OAuth menolak service account (${response.status}).`,
      });
    }
    const body = (await response.json()) as { access_token?: string; expires_in?: number };
    if (!body.access_token) {
      throw new UnauthorizedException({ code: 'BILLING_AUTH_FAILED', title: 'Autentikasi provider gagal', detail: 'Access token tidak diterima.' });
    }
    this.cachedToken = { value: body.access_token, expiresAt: Date.now() + (body.expires_in ?? 3600) * 1000 };
    return body.access_token;
  }

  async verify(input: VerifyInput): Promise<VerifiedPurchase> {
    this.assertConfigured();
    const token = await this.accessToken();
    const url = `${this.config.googlePlayApiBase.replace(/\/$/, '')}/androidpublisher/v3/applications/${encodeURIComponent(this.config.googlePlayPackageName)}/purchases/subscriptionsv2/tokens/${encodeURIComponent(input.purchaseToken)}`;
    const response = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(10_000),
    });
    if (response.status === 404) {
      throw new UnauthorizedException({ code: 'PURCHASE_NOT_FOUND', title: 'Pembelian tidak ditemukan', detail: 'Token pembelian tidak dikenal provider.' });
    }
    if (!response.ok) {
      throw new ServiceUnavailableException({
        code: 'BILLING_PROVIDER_UNAVAILABLE',
        title: 'Provider pembelian tidak tersedia',
        detail: `Google Play membalas ${response.status}.`,
      });
    }
    const body = (await response.json()) as {
      subscriptionState?: string;
      acknowledgementState?: string;
      lineItems?: Array<{ productId?: string; expiryTime?: string; autoRenewingPlan?: { autoRenewEnabled?: boolean } }>;
      linkedPurchaseToken?: string;
      startTime?: string;
    };
    const line = body.lineItems?.[0];
    if (!line?.productId) {
      throw new UnauthorizedException({ code: 'PURCHASE_INVALID', title: 'Pembelian tidak valid', detail: 'Provider tidak mengembalikan line item.' });
    }
    if (line.productId !== input.productId) {
      throw new UnauthorizedException({ code: 'PURCHASE_PRODUCT_MISMATCH', title: 'Produk tidak cocok', detail: 'Token bukan untuk produk yang diklaim.' });
    }
    return {
      productId: line.productId,
      basePlanId: input.basePlanId ?? null,
      state: STATE_MAP[body.subscriptionState ?? ''] ?? 'pending',
      expiresAt: line.expiryTime ?? null,
      startedAt: body.startTime ?? null,
      autoRenew: line.autoRenewingPlan?.autoRenewEnabled ?? false,
      acknowledged: body.acknowledgementState === 'ACKNOWLEDGEMENT_STATE_ACKNOWLEDGED',
      linkedPurchaseToken: body.linkedPurchaseToken ?? null,
      raw: body as Record<string, unknown>,
    };
  }
}
