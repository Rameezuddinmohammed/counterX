/**
 * Tests for WebhookInbox: signature verification, deduplication,
 * ordering, dead letter queue, and FIFO processing.
 */

import { describe, it, expect, beforeEach } from "vitest";

import { WebhookInbox } from "./webhook-inbox.js";
import type { WebhookHeaders } from "./webhook-inbox.js";
import type { WebhookEvent, WebhookProductPayload } from "./catalog-sync.js";

// ─── Test Helpers ─────────────────────────────────────────────────────────────

const TEST_SECRET = "test-webhook-secret";

async function computeHmac(body: Uint8Array, secret: string): Promise<string> {
  const encoder = new TextEncoder();
  const keyData = encoder.encode(secret);
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    keyData,
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign("HMAC", cryptoKey, body);
  // Return base64-encoded HMAC to match Shopify's X-Shopify-Hmac-Sha256 header format
  return Buffer.from(signature).toString("base64");
}

function makePayload(id: number, updatedAt: string): string {
  return JSON.stringify({
    id,
    title: `Product ${String(id)}`,
    body_html: `<p>Product ${String(id)}</p>`,
    status: "active",
    created_at: "2024-01-01T00:00:00.000Z",
    updated_at: updatedAt,
    variants: [
      {
        id: id * 10,
        title: "Default",
        sku: `SKU-${String(id)}`,
        price: "19.99",
        inventory_quantity: 100,
      },
    ],
  });
}

async function makeValidHeaders(
  body: Uint8Array,
  webhookId: string,
  topic = "products/update",
): Promise<WebhookHeaders> {
  const hmac = await computeHmac(body, TEST_SECRET);
  return {
    "x-shopify-webhook-id": webhookId,
    "x-shopify-topic": topic,
    "x-shopify-shop-domain": "test-store.myshopify.com",
    "x-shopify-hmac-sha256": hmac,
  };
}

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("WebhookInbox", () => {
  let inbox: WebhookInbox;
  let processedEvents: WebhookEvent[];

  beforeEach(() => {
    processedEvents = [];
    inbox = new WebhookInbox(TEST_SECRET, (event) => {
      processedEvents.push(event);
    });
  });

  describe("signature verification", () => {
    it("accepts webhook with valid HMAC signature", async () => {
      const payload = makePayload(1, "2024-06-15T00:00:00.000Z");
      const body = new TextEncoder().encode(payload);
      const headers = await makeValidHeaders(body, "wh-001");

      const result = await inbox.receive(body, headers);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("accepted");
      }
    });

    it("rejects webhook with invalid HMAC signature", async () => {
      const payload = makePayload(1, "2024-06-15T00:00:00.000Z");
      const body = new TextEncoder().encode(payload);
      const headers: WebhookHeaders = {
        "x-shopify-webhook-id": "wh-001",
        "x-shopify-topic": "products/update",
        "x-shopify-shop-domain": "test-store.myshopify.com",
        "x-shopify-hmac-sha256": "invalid_hmac_value_that_should_not_match",
      };

      const result = await inbox.receive(body, headers);

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("rejected");
        if (result.value.status === "rejected") {
          expect(result.value.reason).toContain("Invalid HMAC");
        }
      }
    });
  });

  describe("deduplication", () => {
    it("rejects duplicate webhook ID on second delivery", async () => {
      const payload = makePayload(1, "2024-06-15T00:00:00.000Z");
      const body = new TextEncoder().encode(payload);
      const headers = await makeValidHeaders(body, "wh-duplicate");

      // First delivery
      const result1 = await inbox.receive(body, headers);
      expect(result1.ok).toBe(true);
      if (result1.ok) {
        expect(result1.value.status).toBe("accepted");
      }

      // Process the event to mark it as done
      inbox.process();

      // Second delivery (duplicate)
      const result2 = await inbox.receive(body, headers);
      expect(result2.ok).toBe(true);
      if (result2.ok) {
        expect(result2.value.status).toBe("already_processed");
        if (result2.value.status === "already_processed") {
          expect(result2.value.webhookId).toBe("wh-duplicate");
        }
      }
    });

    it("rejects duplicate even if still pending (not yet processed)", async () => {
      const payload = makePayload(1, "2024-06-15T00:00:00.000Z");
      const body = new TextEncoder().encode(payload);
      const headers = await makeValidHeaders(body, "wh-pending-dup");

      // First delivery
      await inbox.receive(body, headers);
      // Do NOT process - still pending

      // Second delivery
      const result = await inbox.receive(body, headers);
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("already_processed");
      }
    });
  });

  describe("out-of-order webhooks", () => {
    it("out-of-order delivery resolved by updatedAt via handler", async () => {
      // This is handled at the CatalogSyncService level, not the inbox.
      // The inbox queues events in FIFO order. The handler resolves conflicts.
      const payload1 = makePayload(1, "2024-06-15T00:00:00.000Z");
      const body1 = new TextEncoder().encode(payload1);
      const headers1 = await makeValidHeaders(body1, "wh-order-1");

      const payload2 = makePayload(1, "2024-06-10T00:00:00.000Z");
      const body2 = new TextEncoder().encode(payload2);
      const headers2 = await makeValidHeaders(body2, "wh-order-2");

      await inbox.receive(body1, headers1);
      await inbox.receive(body2, headers2);

      // Process both
      inbox.process();
      inbox.process();

      // Both events were delivered to handler
      expect(processedEvents).toHaveLength(2);
      // The handler receives both; conflict resolution is at the sync layer
    });
  });

  describe("dead letter queue", () => {
    it("moves event to dead letter after max retries", async () => {
      let callCount = 0;
      const failingInbox = new WebhookInbox(
        TEST_SECRET,
        () => {
          callCount++;
          throw new Error("Processing failed");
        },
        3, // maxRetries
      );

      const payload = makePayload(1, "2024-06-15T00:00:00.000Z");
      const body = new TextEncoder().encode(payload);
      const headers = await makeValidHeaders(body, "wh-failing");

      await failingInbox.receive(body, headers);

      // Try processing 3 times
      failingInbox.process();
      failingInbox.process();
      failingInbox.process();

      expect(callCount).toBe(3);
      expect(failingInbox.getDeadLetters()).toHaveLength(1);
      expect(failingInbox.getDeadLetters()[0]!.webhookId).toBe("wh-failing");
      expect(failingInbox.getDeadLetters()[0]!.attempts).toBe(3);
      expect(failingInbox.getDeadLetters()[0]!.lastError).toContain("Processing failed");
      expect(failingInbox.getPendingCount()).toBe(0);
    });

    it("does not move to dead letter before max retries", async () => {
      let callCount = 0;
      const failingInbox = new WebhookInbox(
        TEST_SECRET,
        () => {
          callCount++;
          if (callCount < 3) {
            throw new Error("Temporary failure");
          }
          // Succeeds on 3rd attempt
        },
        3,
      );

      const payload = makePayload(1, "2024-06-15T00:00:00.000Z");
      const body = new TextEncoder().encode(payload);
      const headers = await makeValidHeaders(body, "wh-retry-success");

      await failingInbox.receive(body, headers);

      // First two fail
      failingInbox.process();
      failingInbox.process();
      // Third succeeds
      failingInbox.process();

      expect(failingInbox.getDeadLetters()).toHaveLength(0);
      expect(failingInbox.getPendingCount()).toBe(0);
    });
  });

  describe("FIFO processing", () => {
    it("processes queue in FIFO order", async () => {
      const payload1 = makePayload(1, "2024-06-10T00:00:00.000Z");
      const body1 = new TextEncoder().encode(payload1);
      const headers1 = await makeValidHeaders(body1, "wh-fifo-1");

      const payload2 = makePayload(2, "2024-06-11T00:00:00.000Z");
      const body2 = new TextEncoder().encode(payload2);
      const headers2 = await makeValidHeaders(body2, "wh-fifo-2");

      const payload3 = makePayload(3, "2024-06-12T00:00:00.000Z");
      const body3 = new TextEncoder().encode(payload3);
      const headers3 = await makeValidHeaders(body3, "wh-fifo-3");

      await inbox.receive(body1, headers1);
      await inbox.receive(body2, headers2);
      await inbox.receive(body3, headers3);

      inbox.process();
      inbox.process();
      inbox.process();

      expect(processedEvents).toHaveLength(3);
      expect((processedEvents[0]!.payload as WebhookProductPayload).id).toBe(1);
      expect((processedEvents[1]!.payload as WebhookProductPayload).id).toBe(2);
      expect((processedEvents[2]!.payload as WebhookProductPayload).id).toBe(3);
    });

    it("returns false when queue is empty", () => {
      const result = inbox.process();
      expect(result).toBe(false);
    });
  });
});
