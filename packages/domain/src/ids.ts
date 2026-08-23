import { randomBytes as nodeRandomBytes } from "node:crypto";
import type { Brand } from "./brand.js";
import { createCanonicalError } from "./errors.js";
import { err, ok, type Result } from "./result.js";

export const COUNTER_ID_ENTROPY_BYTES = 16;
export const COUNTER_ID_PREFIX = "ctr";
export const COUNTER_ID_KINDS = [
  "actor",
  "merchant-user",
  "wallet-user",
  "merchant",
  "wallet",
  "agent",
  "operator",
  "service",
  "support-grant",
  "correlation",
  "key",
  "mandate",
  "payment-reference",
  "quote",
  "transaction",
  "policy-decision",
  "idempotency",
  "workflow",
  "job",
  "outbox-event",
  "inbox-event",
  "evidence",
  "finding",
  "receipt",
  "device",
  "registration",
  "command",
] as const;

export type CounterIdKind = (typeof COUNTER_ID_KINDS)[number];

const counterIdKindSet: ReadonlySet<string> = new Set(COUNTER_ID_KINDS);
const counterIdPattern = /^ctr_([a-z][a-z0-9-]{0,31})_([A-Za-z0-9_-]{22})$/u;
const externalSourcePattern = /^[a-z][a-z0-9.-]{0,63}$/u;

function containsControlCharacter(value: string): boolean {
  for (const character of value) {
    const codePoint = character.codePointAt(0);
    if (codePoint !== undefined && (codePoint <= 0x1f || codePoint === 0x7f)) {
      return true;
    }
  }
  return false;
}

function hasCanonicalEntropyEncoding(encoded: string): boolean {
  const decoded = Buffer.from(encoded, "base64url");
  return (
    decoded.byteLength === COUNTER_ID_ENTROPY_BYTES &&
    Buffer.from(decoded).toString("base64url") === encoded
  );
}

export type CounterId<Kind extends CounterIdKind = CounterIdKind> = Brand<
  string,
  `CounterId:${Kind}`
>;
export type ActorId = CounterId<"actor">;
export type MerchantUserId = CounterId<"merchant-user">;
export type WalletUserId = CounterId<"wallet-user">;
export type MerchantId = CounterId<"merchant">;
export type WalletId = CounterId<"wallet">;
export type AgentId = CounterId<"agent">;
export type OperatorId = CounterId<"operator">;
export type ServiceId = CounterId<"service">;
export type SupportGrantId = CounterId<"support-grant">;
export type CorrelationId = CounterId<"correlation">;
export type KeyId = CounterId<"key">;

export interface ParsedCounterId {
  readonly id: CounterId;
  readonly kind: CounterIdKind;
}

export interface ExternalReference {
  readonly source: string;
  readonly value: string;
}

export type RandomByteSource = (length: number) => Uint8Array;

export interface IdGenerator {
  generate<Kind extends CounterIdKind>(kind: Kind): CounterId<Kind>;
}

export function isCounterIdKind(value: unknown): value is CounterIdKind {
  return typeof value === "string" && counterIdKindSet.has(value);
}

export function createCounterId<Kind extends CounterIdKind>(
  kind: Kind,
  entropy: Uint8Array,
): Result<CounterId<Kind>> {
  if (!isCounterIdKind(kind)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "UNSUPPORTED_VALUE",
        message: "Counter ID kind is not in the reviewed vocabulary",
      }),
    );
  }

  if (entropy.byteLength !== COUNTER_ID_ENTROPY_BYTES) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "OUT_OF_RANGE",
        message: "Counter IDs require exactly 128 bits of entropy",
      }),
    );
  }

  const encoded = Buffer.from(entropy).toString("base64url");
  return ok(`${COUNTER_ID_PREFIX}_${kind}_${encoded}` as CounterId<Kind>);
}

export function parseAnyCounterId(value: unknown): Result<ParsedCounterId> {
  if (typeof value !== "string") {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_TYPE",
        message: "Counter ID must be a string",
      }),
    );
  }

  const match = counterIdPattern.exec(value);
  const kind = match?.[1];
  const encodedEntropy = match?.[2];
  if (
    !isCounterIdKind(kind) ||
    encodedEntropy === undefined ||
    !hasCanonicalEntropyEncoding(encodedEntropy)
  ) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Counter ID has an invalid canonical format",
      }),
    );
  }

  return ok(Object.freeze({ id: value as CounterId, kind }));
}

export function parseCounterId<Kind extends CounterIdKind>(
  value: unknown,
  expectedKind: Kind,
): Result<CounterId<Kind>> {
  const parsed = parseAnyCounterId(value);
  if (!parsed.ok) {
    return parsed;
  }
  if (parsed.value.kind !== expectedKind) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "Counter ID kind does not match the expected kind",
      }),
    );
  }

  return ok(parsed.value.id as CounterId<Kind>);
}

export function isCounterId(value: unknown): value is CounterId {
  if (typeof value !== "string") {
    return false;
  }
  const match = counterIdPattern.exec(value);
  return (
    isCounterIdKind(match?.[1]) && match?.[2] !== undefined && hasCanonicalEntropyEncoding(match[2])
  );
}

export function counterIdKind(id: CounterId): CounterIdKind {
  const parsed = parseAnyCounterId(id);
  if (!parsed.ok) {
    throw new TypeError("CounterId invariant violated");
  }
  return parsed.value.kind;
}

export function createExternalReference(
  source: unknown,
  value: unknown,
): Result<ExternalReference> {
  if (typeof source !== "string" || !externalSourcePattern.test(source)) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "External reference source has an invalid format",
      }),
    );
  }
  if (
    typeof value !== "string" ||
    value.length === 0 ||
    value.length > 256 ||
    value.trim() !== value ||
    containsControlCharacter(value)
  ) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "INVALID_FORMAT",
        message: "External reference value has an invalid format",
      }),
    );
  }

  return ok(Object.freeze({ source, value }));
}

const systemRandomBytes: RandomByteSource = (length) => nodeRandomBytes(length);

export class CryptoIdGenerator implements IdGenerator {
  readonly #randomByteSource: RandomByteSource;

  public constructor(randomByteSource: RandomByteSource = systemRandomBytes) {
    this.#randomByteSource = randomByteSource;
  }

  public generate<Kind extends CounterIdKind>(kind: Kind): CounterId<Kind> {
    const generated = createCounterId(kind, this.#randomByteSource(COUNTER_ID_ENTROPY_BYTES));
    if (!generated.ok) {
      throw new TypeError(generated.error.message);
    }
    return generated.value;
  }
}
