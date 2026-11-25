export type VerifiedState =
  | 'active' | 'in_grace' | 'canceled' | 'expired' | 'paused' | 'on_hold' | 'pending';

export type VerifiedPurchase = {
  productId: string;
  basePlanId: string | null;
  state: VerifiedState;
  expiresAt: string | null;
  startedAt: string | null;
  autoRenew: boolean;
  acknowledged: boolean;
  linkedPurchaseToken: string | null;
  raw: Record<string, unknown>;
};

export type VerifyInput = {
  purchaseToken: string;
  productId: string;
  basePlanId?: string;
};

export interface PurchaseVerifier {
  readonly name: string;
  verify(input: VerifyInput): Promise<VerifiedPurchase>;
}

export const PURCHASE_VERIFIER = Symbol('PURCHASE_VERIFIER');
