import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import {
  AUTHORITY_MAP,
  getAuthoritativeSource,
  isAuthoritative,
} from "./source-authority.js";
import {
  CANONICAL_CLAIM_TYPES,
  EVIDENCE_SOURCES,
} from "./types.js";
import type { CanonicalClaimType, EvidenceSource } from "./types.js";

describe("source-authority", () => {
  describe("AUTHORITY_MAP", () => {
    it("agent_claim is NEVER authoritative for any claim type", () => {
      expect(AUTHORITY_MAP.agent_claim).toHaveLength(0);
    });

    it("counter_service has no authoritative claim types in the canonical list", () => {
      expect(AUTHORITY_MAP.counter_service).toHaveLength(0);
    });

    it("wallet_intent covers intent/consent claims", () => {
      expect(AUTHORITY_MAP.wallet_intent).toContain("intent_created");
      expect(AUTHORITY_MAP.wallet_intent).toContain("consent_given");
      expect(AUTHORITY_MAP.wallet_intent).toContain("consent_revoked");
    });

    it("merchant_connector covers order/fulfillment claims", () => {
      expect(AUTHORITY_MAP.merchant_connector).toContain("order_committed");
      expect(AUTHORITY_MAP.merchant_connector).toContain("order_cancelled");
      expect(AUTHORITY_MAP.merchant_connector).toContain("fulfillment_shipped");
      expect(AUTHORITY_MAP.merchant_connector).toContain("fulfillment_delivered");
    });

    it("payment_provider covers payment/authorization/refund claims", () => {
      expect(AUTHORITY_MAP.payment_provider).toContain("payment_confirmed");
      expect(AUTHORITY_MAP.payment_provider).toContain("payment_declined");
      expect(AUTHORITY_MAP.payment_provider).toContain("payment_pending");
      expect(AUTHORITY_MAP.payment_provider).toContain("refund_issued");
      expect(AUTHORITY_MAP.payment_provider).toContain("refund_declined");
      expect(AUTHORITY_MAP.payment_provider).toContain("authorization_created");
      expect(AUTHORITY_MAP.payment_provider).toContain("authorization_voided");
    });
  });

  describe("isAuthoritative", () => {
    it("agent_claim is never authoritative for payment claims", () => {
      expect(isAuthoritative("agent_claim", "payment_confirmed")).toBe(false);
      expect(isAuthoritative("agent_claim", "payment_declined")).toBe(false);
      expect(isAuthoritative("agent_claim", "payment_pending")).toBe(false);
    });

    it("agent_claim is never authoritative for order claims", () => {
      expect(isAuthoritative("agent_claim", "order_committed")).toBe(false);
      expect(isAuthoritative("agent_claim", "order_cancelled")).toBe(false);
    });

    it("agent_claim is never authoritative for fulfillment claims", () => {
      expect(isAuthoritative("agent_claim", "fulfillment_shipped")).toBe(false);
      expect(isAuthoritative("agent_claim", "fulfillment_delivered")).toBe(false);
    });

    it("agent_claim is never authoritative for any canonical claim type", () => {
      for (const claimType of CANONICAL_CLAIM_TYPES) {
        expect(isAuthoritative("agent_claim", claimType)).toBe(false);
      }
    });

    it("payment_provider is authoritative for payment claims", () => {
      expect(isAuthoritative("payment_provider", "payment_confirmed")).toBe(true);
      expect(isAuthoritative("payment_provider", "payment_declined")).toBe(true);
    });

    it("merchant_connector is authoritative for order claims", () => {
      expect(isAuthoritative("merchant_connector", "order_committed")).toBe(true);
      expect(isAuthoritative("merchant_connector", "order_cancelled")).toBe(true);
    });

    it("wallet_intent is authoritative for intent/consent claims", () => {
      expect(isAuthoritative("wallet_intent", "intent_created")).toBe(true);
      expect(isAuthoritative("wallet_intent", "consent_given")).toBe(true);
      expect(isAuthoritative("wallet_intent", "consent_revoked")).toBe(true);
    });

    it("property: for each claim type with an authoritative source, at most one source is authoritative", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...CANONICAL_CLAIM_TYPES),
          (claimType: CanonicalClaimType) => {
            const authoritativeSources = EVIDENCE_SOURCES.filter(
              (source: EvidenceSource) => isAuthoritative(source, claimType),
            );
            expect(authoritativeSources.length).toBeLessThanOrEqual(1);
          },
        ),
      );
    });

    it("property: agent_claim is never authoritative for any claim", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...CANONICAL_CLAIM_TYPES),
          (claimType: CanonicalClaimType) => {
            expect(isAuthoritative("agent_claim", claimType)).toBe(false);
          },
        ),
      );
    });
  });

  describe("getAuthoritativeSource", () => {
    it("returns wallet_intent for intent/consent claims", () => {
      expect(getAuthoritativeSource("intent_created")).toBe("wallet_intent");
      expect(getAuthoritativeSource("consent_given")).toBe("wallet_intent");
      expect(getAuthoritativeSource("consent_revoked")).toBe("wallet_intent");
    });

    it("returns merchant_connector for order/fulfillment claims", () => {
      expect(getAuthoritativeSource("order_committed")).toBe("merchant_connector");
      expect(getAuthoritativeSource("order_cancelled")).toBe("merchant_connector");
      expect(getAuthoritativeSource("fulfillment_shipped")).toBe("merchant_connector");
      expect(getAuthoritativeSource("fulfillment_delivered")).toBe("merchant_connector");
    });

    it("returns payment_provider for payment/auth/refund claims", () => {
      expect(getAuthoritativeSource("payment_confirmed")).toBe("payment_provider");
      expect(getAuthoritativeSource("payment_declined")).toBe("payment_provider");
      expect(getAuthoritativeSource("payment_pending")).toBe("payment_provider");
      expect(getAuthoritativeSource("refund_issued")).toBe("payment_provider");
      expect(getAuthoritativeSource("refund_declined")).toBe("payment_provider");
      expect(getAuthoritativeSource("authorization_created")).toBe("payment_provider");
      expect(getAuthoritativeSource("authorization_voided")).toBe("payment_provider");
    });
  });
});
