import type { Environment } from "./environment.js";
import type {
  AgentId,
  MerchantId,
  MerchantUserId,
  OperatorId,
  ServiceId,
  WalletId,
  WalletUserId,
} from "./ids.js";

export const ACTOR_KINDS = [
  "merchant_user",
  "wallet_user",
  "registered_agent",
  "operator",
  "service",
] as const;

export type ActorKind = (typeof ACTOR_KINDS)[number];

export type ActorReference =
  | { readonly kind: "merchant_user"; readonly id: MerchantUserId }
  | { readonly kind: "wallet_user"; readonly id: WalletUserId }
  | { readonly kind: "registered_agent"; readonly id: AgentId }
  | { readonly kind: "operator"; readonly id: OperatorId }
  | { readonly kind: "service"; readonly id: ServiceId };

export interface MerchantScope {
  readonly kind: "merchant";
  readonly environment: Environment;
  readonly merchantId: MerchantId;
}

export interface WalletScope {
  readonly kind: "wallet";
  readonly environment: Environment;
  readonly walletId: WalletId;
}

export interface PlatformScope {
  readonly kind: "platform";
  readonly environment: Environment;
}

export type Scope = MerchantScope | WalletScope | PlatformScope;

export function merchantScope(environment: Environment, merchantId: MerchantId): MerchantScope {
  return Object.freeze({ kind: "merchant", environment, merchantId });
}

export function walletScope(environment: Environment, walletId: WalletId): WalletScope {
  return Object.freeze({ kind: "wallet", environment, walletId });
}

export function platformScope(environment: Environment): PlatformScope {
  return Object.freeze({ kind: "platform", environment });
}

export function scopeKey(scope: Scope): string {
  switch (scope.kind) {
    case "merchant":
      return `${scope.environment}:merchant:${scope.merchantId}`;
    case "wallet":
      return `${scope.environment}:wallet:${scope.walletId}`;
    case "platform":
      return `${scope.environment}:platform`;
  }
}

export function scopesEqual(left: Scope, right: Scope): boolean {
  return scopeKey(left) === scopeKey(right);
}
