import { describe, expect, it } from "vitest";
import type { Instant, MerchantId, WalletId } from "@counter/domain";
import {
  CORPUS_VERSION,
  getScenarioCorpus,
  getScenarioById,
  getScenariosByCategory,
  getScenarioCount,
} from "./scenario-corpus.js";
import type { ScenarioContext } from "./scenario-corpus.js";

// ---------------------------------------------------------------------------
// Test Helpers
// ---------------------------------------------------------------------------

const TEST_WALLET_ID = "ctr_wallet_dGVzdC13YWxsZXQtMDAx" as WalletId;
const TEST_MERCHANT_ID = "ctr_merchant_dGVzdC1tZXJjaGFudC0w" as MerchantId;
const TEST_NOW = 1737000000000 as Instant;

function makeTestContext(): ScenarioContext {
  return Object.freeze({
    walletId: TEST_WALLET_ID,
    merchantId: TEST_MERCHANT_ID,
    now: TEST_NOW,
  });
}

// ---------------------------------------------------------------------------
// Corpus Integrity Tests
// ---------------------------------------------------------------------------

describe("Scenario Corpus", () => {
  describe("corpus metadata", () => {
    it("has a semantic version", () => {
      expect(CORPUS_VERSION).toMatch(/^\d+\.\d+\.\d+$/);
      expect(CORPUS_VERSION).toBe("1.0.0");
    });

    it("contains at least 17 scenarios as required by PILOT.md", () => {
      expect(getScenarioCount()).toBeGreaterThanOrEqual(17);
    });
  });

  describe("scenario definitions", () => {
    const corpus = getScenarioCorpus();

    it("all scenarios have unique IDs", () => {
      const ids = corpus.map((s) => s.id);
      const uniqueIds = new Set(ids);
      expect(uniqueIds.size).toBe(ids.length);
    });

    it("all scenarios have required fields", () => {
      for (const scenario of corpus) {
        expect(scenario.id).toBeTruthy();
        expect(scenario.name).toBeTruthy();
        expect(scenario.description).toBeTruthy();
        expect(scenario.expectedOutcome).toBeTruthy();
        expect(scenario.category).toBeTruthy();
        expect(typeof scenario.setup).toBe("function");
        expect(typeof scenario.assertion).toBe("function");
      }
    });

    it("all scenarios have valid expected outcomes", () => {
      const validOutcomes = ["success", "declined", "review_required", "indeterminate", "error"];
      for (const scenario of corpus) {
        expect(validOutcomes).toContain(scenario.expectedOutcome);
      }
    });

    it("all scenarios have valid categories", () => {
      const validCategories = [
        "happy_path",
        "provenance",
        "denial",
        "limit_expiry",
        "security",
        "uncertainty",
      ];
      for (const scenario of corpus) {
        expect(validCategories).toContain(scenario.category);
      }
    });
  });

  describe("scenario setup functions", () => {
    const corpus = getScenarioCorpus();
    const ctx = makeTestContext();

    it("all setup functions return valid ScenarioSetupResult", () => {
      for (const scenario of corpus) {
        const result = scenario.setup(ctx);
        expect(result.context).toBeDefined();
        expect(result.context.walletId).toBeDefined();
        expect(result.context.merchantId).toBeDefined();
        expect(result.context.now).toBeDefined();
        expect(result.params).toBeDefined();
      }
    });

    it("setup functions are deterministic", () => {
      for (const scenario of corpus) {
        const result1 = scenario.setup(ctx);
        const result2 = scenario.setup(ctx);
        expect(result1.params).toEqual(result2.params);
      }
    });
  });

  describe("scenario assertions", () => {
    it("happy path assertions validate success outcome", () => {
      const happyPaths = getScenariosByCategory("happy_path");
      expect(happyPaths.length).toBeGreaterThan(0);

      for (const scenario of happyPaths) {
        const ctx = makeTestContext();
        const successResult = scenario.assertion({
          result: {
            outcome: "success",
            phase: "receipt",
            details: "Completed",
            receiptId: "receipt-001",
          },
          context: ctx,
        });
        expect(successResult).toBe(true);
      }
    });

    it("denial assertions validate declined outcome", () => {
      const denials = getScenariosByCategory("denial");
      expect(denials.length).toBeGreaterThan(0);

      for (const scenario of denials) {
        const ctx = makeTestContext();
        const deniedResult = scenario.assertion({
          result: {
            outcome: "declined",
            phase: "policy_check",
            details: "Denied",
          },
          context: ctx,
        });
        expect(deniedResult).toBe(true);
      }
    });

    it("uncertainty assertions validate indeterminate outcome", () => {
      const uncertainties = getScenariosByCategory("uncertainty");
      expect(uncertainties.length).toBeGreaterThan(0);

      for (const scenario of uncertainties) {
        const ctx = makeTestContext();
        const indeterminateResult = scenario.assertion({
          result: {
            outcome: "indeterminate",
            phase: "payment_execution",
            details: "Timeout",
          },
          context: ctx,
        });
        expect(indeterminateResult).toBe(true);
      }
    });
  });

  describe("getScenarioById", () => {
    it("returns the correct scenario for a valid ID", () => {
      const scenario = getScenarioById("SCENARIO-001");
      expect(scenario).toBeDefined();
      expect(scenario!.name).toBe("Prompt-triggered unattended purchase below threshold");
    });

    it("returns undefined for an invalid ID", () => {
      const scenario = getScenarioById("SCENARIO-999");
      expect(scenario).toBeUndefined();
    });
  });

  describe("getScenariosByCategory", () => {
    it("returns correct counts for each category", () => {
      const happyPaths = getScenariosByCategory("happy_path");
      const denials = getScenariosByCategory("denial");
      const uncertainties = getScenariosByCategory("uncertainty");

      expect(happyPaths.length).toBe(3);
      expect(denials.length).toBe(3);
      expect(uncertainties.length).toBe(2);
    });
  });

  describe("representative scenario execution", () => {
    it("SCENARIO-001: unattended purchase below threshold succeeds", () => {
      const scenario = getScenarioById("SCENARIO-001")!;
      const ctx = makeTestContext();
      const setup = scenario.setup(ctx);

      expect(setup.params["triggerType"]).toBe("prompt");
      expect(setup.params["requiresApproval"]).toBe(false);

      const passed = scenario.assertion({
        result: { outcome: "success", phase: "receipt", details: "OK" },
        context: setup.context,
      });
      expect(passed).toBe(true);
    });

    it("SCENARIO-007: non-allowlisted merchant is denied", () => {
      const scenario = getScenarioById("SCENARIO-007")!;
      const ctx = makeTestContext();
      const setup = scenario.setup(ctx);

      expect(setup.params["merchantAllowlisted"]).toBe(false);

      const passed = scenario.assertion({
        result: { outcome: "declined", phase: "policy_check", details: "Not allowlisted" },
        context: setup.context,
      });
      expect(passed).toBe(true);
    });

    it("SCENARIO-014: duplicate request produces single effect", () => {
      const scenario = getScenarioById("SCENARIO-014")!;
      const ctx = makeTestContext();
      const setup = scenario.setup(ctx);

      expect(setup.params["duplicateRequest"]).toBe(true);
      expect(setup.params["idempotencyKey"]).toBe("idem-test-duplicate-001");

      const passed = scenario.assertion({
        result: { outcome: "success", phase: "receipt", details: "Idempotent" },
        context: setup.context,
      });
      expect(passed).toBe(true);
    });

    it("SCENARIO-017: timeout results in indeterminate", () => {
      const scenario = getScenarioById("SCENARIO-017")!;
      const ctx = makeTestContext();
      const setup = scenario.setup(ctx);

      expect(setup.params["simulateTimeout"]).toBe(true);

      const passed = scenario.assertion({
        result: { outcome: "indeterminate", phase: "payment_execution", details: "Timeout" },
        context: setup.context,
      });
      expect(passed).toBe(true);
    });
  });
});
