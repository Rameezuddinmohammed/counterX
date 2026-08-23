import "./crypto-setup.js";
/**
 * @counter/trust-protocol
 *
 * Counter Trust Protocol (CTP) envelope/object schemas, canonicalization,
 * digesting, Ed25519 signing/verification, and verification checks
 * (see TRUST-PROTOCOL.md and ADR-0002/0003/0006).
 *
 * This package intentionally imports no frameworks, database drivers, cloud
 * SDKs, providers, MCP transports, or adapters (ADR-0001).
 */

export const PACKAGE_NAME = "@counter/trust-protocol";

// Types and interfaces
export type {
  CtpEnvelope,
  UnsignedCtpEnvelope,
  CtpSignature,
  CtpObjectType,
  CtpEnvironment,
  CtpSignatureAlgorithm,
  Nonce,
  SignatureValue,
  EvidenceRef,
  AgentRegistrationPayload,
  BuyerPolicyPayload,
  PrincipalConsentAttestationPayload,
  MandatePayload,
  MerchantQuotePayload,
  PurchaseIntentPayload,
  ApprovalPayload,
  RevocationPayload,
  PaymentAuthorizationReferencePayload,
  PolicyDecisionPayload,
  TransactionStatePayload,
  EvidencePayload,
  FindingPayload,
  TransactionReceiptPayload,
  CtpPayloadMap,
  MoneyAmount,
  RollingLimit,
  TimeWindow,
  QuoteItem,
  IntentItem,
  StateEntry,
  CompensationCommand,
  ReceiptItem,
  CommercialTotals,
} from "./types.js";

export {
  CTP_VERSION,
  CTP_OBJECT_TYPES,
  CTP_ENVIRONMENTS,
  CTP_SIGNATURE_ALGORITHM,
  isCtpObjectType,
  isCtpEnvironment,
} from "./types.js";

// Canonicalization and digest
export {
  canonicalizeUnsignedEnvelope,
  canonicalBytesForVerification,
  computeSha256Digest,
  computePayloadDigest,
  canonicalizeToString,
} from "./canonicalize.js";

// Key management
export type { KeyRecord, KeyRegistry, KeyStatus, KeyUse } from "./keys.js";
export {
  KEY_STATUSES,
  KEY_USES,
  isKeyStatus,
  InMemoryKeyRegistry,
  validateKeyForVerification,
} from "./keys.js";

// Signing
export type { Signer } from "./sign.js";
export { InMemorySigner, signEnvelope, derivePublicKey } from "./sign.js";

// Verification
export type { VerifyOptions, NonceStore } from "./verify.js";
export {
  verifyEnvelope,
  validateEnvelopeSchema,
  InMemoryNonceStore,
  KNOWN_ENVELOPE_FIELDS,
} from "./verify.js";

// Envelope construction
export type { EnvelopeInput } from "./envelope.js";
export { buildUnsignedEnvelope, generateNonce, isCtpEnvelope } from "./envelope.js";

// Concurrent nonce/replay store
export type { ConcurrentNonceStore } from "./nonce-replay-store.js";
export { InMemoryConcurrentNonceStore } from "./nonce-replay-store.js";

// Test fixtures (test-only)
export {
  TEST_KID_A,
  TEST_KID_B,
  TEST_KEY_RECORD_A,
  TEST_KEY_RECORD_B,
  createTestSignerA,
  createTestSignerB,
  createTestUnsignedEnvelope,
  getTestPrivateKeyA,
  getTestPrivateKeyB,
  getTestPublicKeyA,
  getTestPublicKeyB,
} from "./fixtures.js";
