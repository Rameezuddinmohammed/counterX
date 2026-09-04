import { describe, expect, it } from "vitest";
import { generateOpenApiSpec } from "./openapi-generator.js";
import { MERCHANT_ROUTES } from "./route-schemas.js";

describe("@counter/merchant-contracts", () => {
  describe("OpenAPI spec generation", () => {
    it("generates valid OpenAPI 3.1 JSON", () => {
      const spec = generateOpenApiSpec();
      expect(spec.openapi).toBe("3.1.0");
      expect(spec.info.title).toBe("Counter Merchant Runtime API");
      expect(spec.info.version).toBe("1.0.0");
    });

    it("includes all expected route paths", () => {
      const spec = generateOpenApiSpec();
      const paths = Object.keys(spec.paths);

      expect(paths).toContain("/runtime/v1/merchants/{merchantId}/capabilities");
      expect(paths).toContain("/runtime/v1/merchants/{merchantId}/search");
      expect(paths).toContain("/runtime/v1/merchants/{merchantId}/products/{variantId}");
      expect(paths).toContain("/runtime/v1/merchants/{merchantId}/quotes");
      expect(paths).toContain("/runtime/v1/merchants/{merchantId}/transactions");
      expect(paths).toContain("/runtime/v1/merchants/{merchantId}/transactions/{transactionId}");
      expect(paths).toContain(
        "/runtime/v1/merchants/{merchantId}/transactions/{transactionId}/payment-result",
      );
      expect(paths).toContain(
        "/runtime/v1/merchants/{merchantId}/transactions/{transactionId}/cancel",
      );
      expect(paths).toContain(
        "/runtime/v1/merchants/{merchantId}/transactions/{transactionId}/refund",
      );
      expect(paths).toContain(
        "/runtime/v1/merchants/{merchantId}/transactions/{transactionId}/receipt",
      );
    });

    it("defines security scheme for Bearer JWT", () => {
      const spec = generateOpenApiSpec();
      const bearerAuth = spec.components.securitySchemes["bearerAuth"] as Record<string, unknown>;
      expect(bearerAuth).toBeDefined();
      expect(bearerAuth["type"]).toBe("http");
      expect(bearerAuth["scheme"]).toBe("bearer");
      expect(bearerAuth["bearerFormat"]).toBe("JWT");
    });

    it("defines error schemas for all error types", () => {
      const spec = generateOpenApiSpec();
      const schemas = spec.components.schemas;
      expect(schemas["UnauthorizedError"]).toBeDefined();
      expect(schemas["ValidationError"]).toBeDefined();
      expect(schemas["StaleError"]).toBeDefined();
      expect(schemas["ReviewRequiredResponse"]).toBeDefined();
      expect(schemas["IndeterminateError"]).toBeDefined();
    });

    it("produces deterministic JSON output", () => {
      const spec1 = generateOpenApiSpec();
      const spec2 = generateOpenApiSpec();
      expect(JSON.stringify(spec1)).toBe(JSON.stringify(spec2));
    });

    it("unauthorized error shape does not leak resource existence", () => {
      const spec = generateOpenApiSpec();
      const unauthorized = spec.components.schemas["UnauthorizedError"] as Record<string, unknown>;
      const props = (
        unauthorized as { properties: { error: { properties: Record<string, unknown> } } }
      ).properties.error.properties;
      // Code and message are fixed constants - no dynamic resource information
      expect((props["code"] as Record<string, unknown>)["const"]).toBe("UNAUTHENTICATED");
      expect((props["message"] as Record<string, unknown>)["const"]).toBe(
        "Authentication is required",
      );
    });
  });

  describe("route schemas", () => {
    it("defines all pilot route contracts", () => {
      expect(MERCHANT_ROUTES).toHaveLength(11);
    });

    it("all routes require authentication", () => {
      for (const route of MERCHANT_ROUTES) {
        expect(route.requiresAuth).toBe(true);
      }
    });

    it("mutation routes require idempotency", () => {
      const mutationPaths = [
        "/runtime/v1/merchants/:merchantId/quotes",
        "/runtime/v1/merchants/:merchantId/transactions",
        "/runtime/v1/merchants/:merchantId/transactions/:transactionId/payment-result",
        "/runtime/v1/merchants/:merchantId/transactions/:transactionId/cancel",
        "/runtime/v1/merchants/:merchantId/transactions/:transactionId/refund",
      ];

      for (const path of mutationPaths) {
        const route = MERCHANT_ROUTES.find((r) => r.path === path);
        expect(route).toBeDefined();
        expect(route!.requiresIdempotency).toBe(true);
      }
    });

    it("all routes include 401 in error responses", () => {
      for (const route of MERCHANT_ROUTES) {
        expect(route.errorResponses).toContain(401);
      }
    });

    it("stale-capable routes include 409 in error responses", () => {
      const stalePaths = [
        "/runtime/v1/merchants/:merchantId/products/:variantId",
        "/runtime/v1/merchants/:merchantId/transactions/:transactionId",
        "/runtime/v1/merchants/:merchantId/transactions/:transactionId/cancel",
        "/runtime/v1/merchants/:merchantId/transactions/:transactionId/refund",
      ];

      for (const path of stalePaths) {
        const route = MERCHANT_ROUTES.find((r) => r.path === path);
        expect(route).toBeDefined();
        expect(route!.errorResponses).toContain(409);
      }
    });
  });
});
