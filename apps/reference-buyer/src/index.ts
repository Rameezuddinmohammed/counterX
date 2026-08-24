/**
 * @counter/reference-buyer
 *
 * Deterministic Native client and scenario harness for Counter Agent Wallet
 * parity testing. Provides:
 *
 * - Deterministic test identity (seeded Ed25519 keypair)
 * - Mandate, intent, and approval builders (PILOT.md compliant)
 * - ScenarioDriver for full lifecycle execution via port interfaces
 * - Versioned scenario corpus covering all 17 PILOT.md scenarios
 * - Independent receipt verification (CTP signature + commitment digest)
 */

export const APP_NAME = "@counter/reference-buyer";

// Identity
export { createTestBuyerIdentity } from "./identity.js";
export type { TestBuyerIdentity } from "./identity.js";

// Mandate Builder
export { buildTestMandate, resetMandateCounter } from "./mandate-builder.js";
export type { TestMandate, BuildMandateOptions } from "./mandate-builder.js";

// Intent Builder
export { buildTestIntent, resetIntentCounter } from "./intent-builder.js";
export type { TestIntent, BuildIntentOptions } from "./intent-builder.js";

// Approval Builder
export { buildTestApproval, resetApprovalCounter } from "./approval-builder.js";
export type { TestApproval, BuildApprovalOptions } from "./approval-builder.js";

// Scenario Driver
export { ScenarioDriver } from "./scenario-driver.js";
export type {
  ScenarioDriverConfig,
  DriverContext,
  DiscoveryPort,
  SearchPort,
  QuotePort,
  CheckoutPort,
  DiscoveryResult,
  SearchResult,
  QuoteResult,
  QuoteLineItem,
  CheckoutResult,
  ReceiptVerificationResult,
} from "./scenario-driver.js";

// Scenario Corpus
export {
  CORPUS_VERSION,
  getScenarioCorpus,
  getScenarioById,
  getScenariosByCategory,
  getScenarioCount,
} from "./scenario-corpus.js";
export type {
  ScenarioDefinition,
  ScenarioOutcome,
  ScenarioContext,
  ScenarioSetupResult,
  ScenarioAssertionInput,
  ScenarioCategory,
} from "./scenario-corpus.js";

// Receipt Verifier
export { verifyReceiptIndependent } from "./receipt-verifier.js";
export type {
  IndependentVerificationOptions,
  IndependentVerificationResult,
} from "./receipt-verifier.js";
