import { createHmac } from "node:crypto";
import { describe, expect, it, afterEach } from "vitest";
import { generateKeyPair, exportJWK, createLocalJWKSet } from "jose";
import { createServer } from "./index.js";
import type {
  ConfirmRegistrationFromWebhookParams,
  RecurringMandateProvisionerLike,
  BeginRegistrationParams,
  BeginRegistrationResult,
  ConfirmRegistrationParams,
  RecurringMandateSummary,
} from "./recurring-mandate-store.js";
import type { FastifyInstance } from "fastify";

const SHOPIFY_SECRET = "shopify_synthetic_test_secret";
const RAZORPAY_SECRET = "razorpay_synthetic_test_secret";

async function getTestJwks(): Promise<ReturnType<typeof createLocalJWKSet>> {
  const { publicKey } = await generateKeyPair("RS256");
  const publicJwk = await exportJWK(publicKey);
  return createLocalJWKSet({ keys: [{ ...publicJwk, alg: "RS256", use: "sig" }] });
}

function shopifyHmac(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("base64");
}

function razorpayHmac(rawBody: string, secret: string): string {
  return createHmac("sha256", secret).update(rawBody).digest("hex");
}

class FakeRecurringMandateProvisioner implements RecurringMandateProvisionerLike {
  confirmedFromWebhook: ConfirmRegistrationFromWebhookParams[] = [];
  nextConfirmResult: RecurringMandateSummary | undefined = undefined;

  async beginRegistration(_params: BeginRegistrationParams): Promise<BeginRegistrationResult> {
    throw new Error("not used in these tests");
  }
  async confirmRegistration(_params: ConfirmRegistrationParams): Promise<RecurringMandateSummary> {
    throw new Error("not used in these tests");
  }
  async confirmRegistrationFromWebhook(
    params: ConfirmRegistrationFromWebhookParams,
  ): Promise<RecurringMandateSummary | undefined> {
    this.confirmedFromWebhook.push(params);
    return this.nextConfirmResult;
  }
  async revoke(): Promise<void> {
    throw new Error("not used in these tests");
  }
  async list(): Promise<readonly RecurringMandateSummary[]> {
    return [];
  }
}

describe("webhook routes", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  describe("POST /webhooks/v1/shopify", () => {
    it("is reachable with no Counter Bearer token at all (real senders carry none)", async () => {
      const jwks = await getTestJwks();
      server = createServer({
        jwks,
        environment: "test",
        webhookRoutes: {
          shopifyWebhookSecret: SHOPIFY_SECRET,
          razorpayWebhookSecret: RAZORPAY_SECRET,
        },
      });
      await server.ready();

      const body = JSON.stringify({
        id: 123,
        title: "Test Product",
        body_html: "",
        status: "active",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        variants: [],
      });

      const response = await server.inject({
        method: "POST",
        url: "/webhooks/v1/shopify",
        headers: {
          "content-type": "application/json",
          "x-shopify-webhook-id": "wh_001",
          "x-shopify-topic": "products/update",
          "x-shopify-shop-domain": "test-store.myshopify.com",
          "x-shopify-hmac-sha256": shopifyHmac(body, SHOPIFY_SECRET),
        },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: "accepted", webhookId: "wh_001" });
    });

    it("rejects an invalid HMAC signature with 401", async () => {
      const jwks = await getTestJwks();
      server = createServer({
        jwks,
        environment: "test",
        webhookRoutes: {
          shopifyWebhookSecret: SHOPIFY_SECRET,
          razorpayWebhookSecret: RAZORPAY_SECRET,
        },
      });
      await server.ready();

      const body = JSON.stringify({ id: 1, title: "x" });
      const response = await server.inject({
        method: "POST",
        url: "/webhooks/v1/shopify",
        headers: {
          "content-type": "application/json",
          "x-shopify-webhook-id": "wh_bad",
          "x-shopify-topic": "products/update",
          "x-shopify-shop-domain": "test-store.myshopify.com",
          "x-shopify-hmac-sha256": "not-a-real-signature",
        },
        payload: body,
      });

      expect(response.statusCode).toBe(401);
    });

    it("deduplicates a redelivered webhook id instead of reprocessing it", async () => {
      const jwks = await getTestJwks();
      server = createServer({
        jwks,
        environment: "test",
        webhookRoutes: {
          shopifyWebhookSecret: SHOPIFY_SECRET,
          razorpayWebhookSecret: RAZORPAY_SECRET,
        },
      });
      await server.ready();

      const body = JSON.stringify({
        id: 2,
        title: "Dup Product",
        body_html: "",
        status: "active",
        created_at: "2026-01-01T00:00:00Z",
        updated_at: "2026-01-01T00:00:00Z",
        variants: [],
      });
      const headers = {
        "content-type": "application/json",
        "x-shopify-webhook-id": "wh_dup",
        "x-shopify-topic": "products/update",
        "x-shopify-shop-domain": "test-store.myshopify.com",
        "x-shopify-hmac-sha256": shopifyHmac(body, SHOPIFY_SECRET),
      };

      const first = await server.inject({
        method: "POST",
        url: "/webhooks/v1/shopify",
        headers,
        payload: body,
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ status: "accepted" });

      const second = await server.inject({
        method: "POST",
        url: "/webhooks/v1/shopify",
        headers,
        payload: body,
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ status: "already_processed" });
    });
  });

  describe("POST /webhooks/v1/razorpay", () => {
    it("rejects a missing signature header with 401", async () => {
      const jwks = await getTestJwks();
      server = createServer({
        jwks,
        environment: "test",
        webhookRoutes: {
          shopifyWebhookSecret: SHOPIFY_SECRET,
          razorpayWebhookSecret: RAZORPAY_SECRET,
        },
      });
      await server.ready();

      const response = await server.inject({
        method: "POST",
        url: "/webhooks/v1/razorpay",
        headers: { "content-type": "application/json" },
        payload: JSON.stringify({ event: "payment.captured" }),
      });

      expect(response.statusCode).toBe(401);
    });

    it("rejects an invalid signature with 401", async () => {
      const jwks = await getTestJwks();
      server = createServer({
        jwks,
        environment: "test",
        webhookRoutes: {
          shopifyWebhookSecret: SHOPIFY_SECRET,
          razorpayWebhookSecret: RAZORPAY_SECRET,
        },
      });
      await server.ready();

      const response = await server.inject({
        method: "POST",
        url: "/webhooks/v1/razorpay",
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": "0".repeat(64),
        },
        payload: JSON.stringify({ event: "payment.captured", payload: {} }),
      });

      expect(response.statusCode).toBe(401);
    });

    it("accepts a validly-signed payment event with a real HMAC", async () => {
      const jwks = await getTestJwks();
      server = createServer({
        jwks,
        environment: "test",
        webhookRoutes: {
          shopifyWebhookSecret: SHOPIFY_SECRET,
          razorpayWebhookSecret: RAZORPAY_SECRET,
        },
      });
      await server.ready();

      const body = JSON.stringify({
        entity: "event",
        account_id: "acc_test",
        event: "payment.captured",
        contains: ["payment"],
        payload: {
          payment: {
            entity: {
              id: "pay_test001",
              entity: "payment",
              amount: 50000,
              currency: "INR",
              status: "captured",
              order_id: "order_test001",
              method: "upi",
              description: null,
              error_code: null,
              error_description: null,
              created_at: 1700000000,
            },
          },
        },
        created_at: 1700000000,
      });

      const response = await server.inject({
        method: "POST",
        url: "/webhooks/v1/razorpay",
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": razorpayHmac(body, RAZORPAY_SECRET),
        },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(response.json()).toMatchObject({ status: "processed", eventId: "pay_test001" });
    });

    it("routes a token-confirmation event to confirmRegistrationFromWebhook", async () => {
      const jwks = await getTestJwks();
      const provisioner = new FakeRecurringMandateProvisioner();
      provisioner.nextConfirmResult = {
        referenceId: "ctr_payment-reference_x",
        status: "active",
        ceilingMinor: "500000",
        currency: "INR",
        validFrom: "2026-01-01T00:00:00Z",
        validUntil: "2027-01-01T00:00:00Z",
        eligibleMerchants: [],
        eligibleOperations: [],
      };
      server = createServer({
        jwks,
        environment: "test",
        webhookRoutes: {
          shopifyWebhookSecret: SHOPIFY_SECRET,
          razorpayWebhookSecret: RAZORPAY_SECRET,
          recurringMandateProvisioner: provisioner,
        },
      });
      await server.ready();

      const body = JSON.stringify({
        entity: "event",
        account_id: "acc_test",
        event: "token.confirmed",
        contains: ["token"],
        payload: {
          token: {
            entity: {
              id: "token_test001",
              customer_id: "cust_test001",
              status: "confirmed",
            },
          },
        },
        created_at: 1700000000,
      });

      const response = await server.inject({
        method: "POST",
        url: "/webhooks/v1/razorpay",
        headers: {
          "content-type": "application/json",
          "x-razorpay-signature": razorpayHmac(body, RAZORPAY_SECRET),
        },
        payload: body,
      });

      expect(response.statusCode).toBe(200);
      expect(provisioner.confirmedFromWebhook).toEqual([
        { providerCustomerId: "cust_test001", providerTokenId: "token_test001" },
      ]);
    });

    it("deduplicates a redelivered event id", async () => {
      const jwks = await getTestJwks();
      server = createServer({
        jwks,
        environment: "test",
        webhookRoutes: {
          shopifyWebhookSecret: SHOPIFY_SECRET,
          razorpayWebhookSecret: RAZORPAY_SECRET,
        },
      });
      await server.ready();

      const body = JSON.stringify({
        entity: "event",
        account_id: "acc_test",
        event: "payment.failed",
        contains: ["payment"],
        payload: {
          payment: {
            entity: {
              id: "pay_dup001",
              entity: "payment",
              amount: 1000,
              currency: "INR",
              status: "failed",
              order_id: "order_dup001",
              method: "card",
              description: null,
              error_code: "BAD_REQUEST_ERROR",
              error_description: "failed",
              created_at: 1700000000,
            },
          },
        },
        created_at: 1700000000,
      });
      const headers = {
        "content-type": "application/json",
        "x-razorpay-signature": razorpayHmac(body, RAZORPAY_SECRET),
      };

      const first = await server.inject({
        method: "POST",
        url: "/webhooks/v1/razorpay",
        headers,
        payload: body,
      });
      expect(first.statusCode).toBe(200);
      expect(first.json()).toMatchObject({ status: "processed" });

      const second = await server.inject({
        method: "POST",
        url: "/webhooks/v1/razorpay",
        headers,
        payload: body,
      });
      expect(second.statusCode).toBe(200);
      expect(second.json()).toMatchObject({ status: "already_processed" });
    });
  });

  describe("optional-feature absence", () => {
    it("does not register webhook routes when webhookRoutes is not configured", async () => {
      const jwks = await getTestJwks();
      server = createServer({ jwks, environment: "test" });
      await server.ready();

      const response = await server.inject({
        method: "POST",
        url: "/webhooks/v1/shopify",
        payload: "{}",
      });

      expect(response.statusCode).toBe(404);
    });
  });
});
