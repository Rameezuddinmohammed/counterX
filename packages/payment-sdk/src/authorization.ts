import type {
  AgentId,
  Environment,
  Instant,
  IsoCurrencyCode,
  MerchantId,
  WalletId,
} from "@counter/domain";
import { createCanonicalError } from "@counter/domain";

export interface PaymentAuthorization {
  readonly referenceId: string;
  readonly adapter: string;
  readonly provider: string | undefined;
  readonly environment: Environment;
  readonly walletId: WalletId;
  readonly principalId: string;
  readonly permittedAgents: readonly AgentId[];
  readonly permittedMerchants: readonly MerchantId[];
  readonly methodClass: string | undefined;
  readonly currency: IsoCurrencyCode | undefined;
  readonly maxAmountMinor: bigint | undefined;
  readonly validFrom: Instant;
  readonly validUntil: Instant;
  readonly testOnly: boolean;
}

export const FORBIDDEN_CREDENTIAL_FIELDS: readonly string[] = [
  "pan",
  "cvv",
  "pin",
  "password",
  "secret",
  "token",
  "upi_pin",
  "bank_credential",
  "raw_token",
];

const forbiddenSet: ReadonlySet<string> = new Set(FORBIDDEN_CREDENTIAL_FIELDS);

/**
 * Recursively scans an object's keys and throws a CanonicalError with code
 * UNAUTHORIZED if any key matches a forbidden credential field name.
 */
export function assertNoRawCredentials(obj: unknown): void {
  if (typeof obj !== "object" || obj === null) {
    return;
  }

  if (Array.isArray(obj)) {
    for (const item of obj) {
      assertNoRawCredentials(item);
    }
    return;
  }

  const record = obj as Readonly<Record<string, unknown>>;
  for (const key of Object.keys(record)) {
    if (forbiddenSet.has(key)) {
      throw createCanonicalError({
        code: "UNAUTHORIZED",
        category: "authorization",
        message: `Raw credentials must not be passed through the payment SDK: found forbidden field "${key}"`,
      });
    }
    assertNoRawCredentials(record[key]);
  }
}
