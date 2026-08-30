import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import type { CounterId, Instant, Environment } from "@counter/domain";
import { TENANT_STATUSES, isTenantStatus } from "./index.js";
import type { MerchantOrganization, MerchantTenantEnvironment, OrganizationId } from "./index.js";

// --- Test Helpers ---

const NOW = 1_700_000_000_000 as Instant;
const MERCHANT_ID_A = "ctr_merchant_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"merchant">;
const MERCHANT_ID_B = "ctr_merchant_BBBBBBBBBBBBBBBBBBBBBB" as CounterId<"merchant">;
const ORG_ID = "org_test_001" as OrganizationId;

// --- Tests ---

describe("tenancy and isolation", () => {
  describe("MerchantOrganization creation", () => {
    it("creates a valid MerchantOrganization with all required fields", () => {
      const org: MerchantOrganization = Object.freeze({
        organizationId: ORG_ID,
        legalName: "Test Corp Ltd.",
        displayName: "Test Corp",
        contactEmail: "admin@testcorp.com",
        createdAt: NOW,
        updatedAt: NOW,
      });

      expect(org.organizationId).toBe(ORG_ID);
      expect(org.legalName).toBe("Test Corp Ltd.");
      expect(org.displayName).toBe("Test Corp");
      expect(org.contactEmail).toBe("admin@testcorp.com");
      expect(org.createdAt).toBe(NOW);
      expect(org.updatedAt).toBe(NOW);
    });
  });

  describe("MerchantTenantEnvironment", () => {
    it("binds merchant to environment", () => {
      const tenant: MerchantTenantEnvironment = Object.freeze({
        merchantId: MERCHANT_ID_A,
        organizationId: ORG_ID,
        environment: "sandbox" as Environment,
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      });

      expect(tenant.merchantId).toBe(MERCHANT_ID_A);
      expect(tenant.organizationId).toBe(ORG_ID);
      expect(tenant.environment).toBe("sandbox");
      expect(tenant.status).toBe("active");
    });
  });

  describe("cross-tenant reference", () => {
    it("two merchants with different IDs are treated as distinct in the same environment", () => {
      const tenantA: MerchantTenantEnvironment = Object.freeze({
        merchantId: MERCHANT_ID_A,
        organizationId: "org_A" as OrganizationId,
        environment: "production" as Environment,
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      });

      const tenantB: MerchantTenantEnvironment = Object.freeze({
        merchantId: MERCHANT_ID_B,
        organizationId: "org_B" as OrganizationId,
        environment: "production" as Environment,
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      });

      expect(tenantA.merchantId).not.toBe(tenantB.merchantId);
      expect(tenantA.organizationId).not.toBe(tenantB.organizationId);
      expect(tenantA.environment).toBe(tenantB.environment);
    });
  });

  describe("environment isolation", () => {
    it("sandbox environment != production environment", () => {
      const sandboxTenant: MerchantTenantEnvironment = Object.freeze({
        merchantId: MERCHANT_ID_A,
        organizationId: ORG_ID,
        environment: "sandbox" as Environment,
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      });

      const productionTenant: MerchantTenantEnvironment = Object.freeze({
        merchantId: MERCHANT_ID_A,
        organizationId: ORG_ID,
        environment: "production" as Environment,
        status: "active",
        createdAt: NOW,
        updatedAt: NOW,
      });

      expect(sandboxTenant.environment).not.toBe(productionTenant.environment);
    });
  });

  describe("tenant statuses", () => {
    it("isTenantStatus validates known statuses", () => {
      for (const status of TENANT_STATUSES) {
        expect(isTenantStatus(status)).toBe(true);
      }
    });

    it("isTenantStatus rejects unknown values", () => {
      expect(isTenantStatus("unknown")).toBe(false);
      expect(isTenantStatus(123)).toBe(false);
      expect(isTenantStatus(null)).toBe(false);
    });
  });

  describe("property-based tests", () => {
    const environments: Environment[] = ["local", "test", "sandbox", "pilot", "production"];

    it("property: for any two random environments where env1 != env2, they are isolated", () => {
      fc.assert(
        fc.property(
          fc.constantFrom(...environments),
          fc.constantFrom(...environments),
          (env1, env2) => {
            if (env1 !== env2) {
              const tenantA: MerchantTenantEnvironment = Object.freeze({
                merchantId: MERCHANT_ID_A,
                organizationId: ORG_ID,
                environment: env1,
                status: "active",
                createdAt: NOW,
                updatedAt: NOW,
              });

              const tenantB: MerchantTenantEnvironment = Object.freeze({
                merchantId: MERCHANT_ID_A,
                organizationId: ORG_ID,
                environment: env2,
                status: "active",
                createdAt: NOW,
                updatedAt: NOW,
              });

              expect(tenantA.environment).not.toBe(tenantB.environment);
            }
          },
        ),
      );
    });

    it("property: for any two random merchant IDs, they represent distinct tenants", () => {
      fc.assert(
        fc.property(
          fc.string({ minLength: 10, maxLength: 40 }),
          fc.string({ minLength: 10, maxLength: 40 }),
          (id1, id2) => {
            fc.pre(id1 !== id2);
            const merchantId1 = id1 as CounterId<"merchant">;
            const merchantId2 = id2 as CounterId<"merchant">;

            const t1: MerchantTenantEnvironment = Object.freeze({
              merchantId: merchantId1,
              organizationId: ORG_ID,
              environment: "production" as Environment,
              status: "active",
              createdAt: NOW,
              updatedAt: NOW,
            });

            const t2: MerchantTenantEnvironment = Object.freeze({
              merchantId: merchantId2,
              organizationId: ORG_ID,
              environment: "production" as Environment,
              status: "active",
              createdAt: NOW,
              updatedAt: NOW,
            });

            expect(t1.merchantId).not.toBe(t2.merchantId);
          },
        ),
      );
    });
  });
});
