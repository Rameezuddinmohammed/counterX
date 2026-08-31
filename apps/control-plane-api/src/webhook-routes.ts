/**
 * Real webhook consumers for Shopify and Razorpay — mounted at
 * POST /webhooks/v1/{shopify,razorpay}, replacing what was previously an
 * unused generic ingress shell (mounted only in agent-runtime, with zero
 * handlers registered for any adapter, per this repo's own audit).
 *
 * Real signature verification with no bypass for both adapters — this is
 * a hard invariant, not a convenience shortcut:
 *   - Shopify: HMAC-SHA256 over the raw body via
 *     @counter/shopify-connector's WebhookInbox (verifyWebhookSignature +
 *     X-Shopify-Webhook-Id dedup), reused as-is.
 *   - Razorpay: HMAC-SHA256 over the raw body via
 *     @counter/razorpay-adapter's hmacSha256/timingSafeEquals — the SAME
 *     scheme RazorpayTestProvider.verifyWebhook already uses internally —
 *     plus @counter/razorpay-adapter's WebhookDeduplicator for event_id
 *     dedup.
 *
 * WebhookInbox's pending-queue/process() machinery is synchronous
 * (`handler: (event) => void`) and cannot safely await an async
 * catalog-write or mandate-confirmation call, so this module uses
 * WebhookInbox.receive() ONLY for its real verify+dedup step, then drives
 * the actual (async) side effect directly in the route handler — the
 * queue/retry/dead-letter machinery inside WebhookInbox itself goes
 * unused here. Both inboxes are in-memory (per their own implementation),
 * so verify+dedup state does not survive a process restart — a known,
 * disclosed limitation, not something this module tries to paper over.
 *
 * Shopify product-catalog writes are deliberately NOT performed by this
 * module: `onShopifyProductWebhook` is an injected callback, wired
 * elsewhere once the durable catalog-sync storage layer lands (see the
 * production-readiness plan's Phase A2). Until wired, product webhooks are
 * still genuinely verified and deduped — they're just not persisted yet.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import { instantFromEpochMilliseconds, type Instant } from "@counter/domain";
import { webhookIngressPlugin, getRawBody, type WebhookHandler } from "@counter/http-api-kit";
import { WebhookInbox, type WebhookHeaders, type WebhookEvent } from "@counter/shopify-connector";
import {
  hmacSha256,
  timingSafeEquals,
  WebhookDeduplicator,
  processWebhookEvent,
  type RazorpayWebhookEvent,
} from "@counter/razorpay-adapter";
import type { RecurringMandateProvisionerLike } from "./recurring-mandate-store.js";

export interface WebhookRoutesOptions {
  readonly shopifyWebhookSecret: string;
  readonly onShopifyProductWebhook?: ((event: WebhookEvent) => Promise<void>) | undefined;
  readonly razorpayWebhookSecret: string;
  readonly recurringMandateProvisioner?: RecurringMandateProvisionerLike | undefined;
  readonly onRazorpayPaymentWebhook?: ((event: RazorpayWebhookEvent) => Promise<void>) | undefined;
}

function nowInstant(): Instant {
  const result = instantFromEpochMilliseconds(Date.now());
  if (!result.ok) {
    throw new Error("Failed to derive current instant for webhook processing");
  }
  return result.value;
}

function requireHeaderString(headers: FastifyRequest["headers"], name: string): string | undefined {
  const value = headers[name];
  return typeof value === "string" ? value : undefined;
}

// ─── Shopify ────────────────────────────────────────────────────────────────

function createShopifyWebhookHandler(options: WebhookRoutesOptions): WebhookHandler {
  const inbox = new WebhookInbox(options.shopifyWebhookSecret);

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const rawBody = getRawBody(request);
    if (rawBody === undefined) {
      void reply
        .status(400)
        .send({ error: { code: "INVALID_FORMAT", message: "Missing raw request body" } });
      return;
    }

    const webhookId = requireHeaderString(request.headers, "x-shopify-webhook-id");
    const topic = requireHeaderString(request.headers, "x-shopify-topic");
    const shopDomain = requireHeaderString(request.headers, "x-shopify-shop-domain");
    const hmac = requireHeaderString(request.headers, "x-shopify-hmac-sha256");
    if (
      webhookId === undefined ||
      topic === undefined ||
      shopDomain === undefined ||
      hmac === undefined
    ) {
      void reply.status(400).send({
        error: { code: "INVALID_FORMAT", message: "Missing required Shopify webhook headers" },
      });
      return;
    }

    const headers: WebhookHeaders = {
      "x-shopify-webhook-id": webhookId,
      "x-shopify-topic": topic,
      "x-shopify-shop-domain": shopDomain,
      "x-shopify-hmac-sha256": hmac,
    };

    const result = await inbox.receive(rawBody, headers);
    if (!result.ok) {
      void reply
        .status(400)
        .send({ error: { code: result.error.code, message: result.error.message } });
      return;
    }

    if (result.value.status === "rejected") {
      void reply
        .status(401)
        .send({ error: { code: "UNAUTHENTICATED", message: result.value.reason } });
      return;
    }

    if (result.value.status === "already_processed") {
      // Real dedup working as intended — 200, not an error, since a
      // redelivered webhook is expected Shopify behavior, not a client bug.
      void reply.status(200).send({ status: "already_processed" });
      return;
    }

    // "accepted" — real, verified, deduped. Drive the (currently stubbed)
    // catalog write directly rather than via WebhookInbox's synchronous
    // process() queue (see module header for why).
    if (options.onShopifyProductWebhook !== undefined) {
      const decoder = new TextDecoder();
      const event: WebhookEvent = Object.freeze({
        topic,
        shopDomain,
        webhookId,
        payload: JSON.parse(decoder.decode(rawBody)),
        receivedAt: nowInstant(),
      });
      try {
        await options.onShopifyProductWebhook(event);
      } catch (error: unknown) {
        // Verification+dedup already succeeded and must not be retried —
        // a downstream write failure is logged, not surfaced as a 4xx/5xx
        // that would make Shopify redeliver (and re-verify/re-dedupe) an
        // event this inbox has already durably marked processed.
        request.log.error({ err: error, webhookId, topic }, "Shopify webhook handler failed");
      }
    }

    void reply.status(200).send({ status: "accepted", webhookId });
  };
}

// ─── Razorpay ─────────────────────────────────────────────────────────────────

/**
 * Razorpay's own documented webhook verification scheme:
 * X-Razorpay-Signature = HMAC_SHA256(raw_body, webhook_secret) — the same
 * check RazorpayTestProvider.verifyWebhook already performs internally
 * (razorpay-provider.ts), reused here rather than re-derived, but done
 * directly against the raw body instead of instantiating a full provider
 * (webhook verification needs only the webhook secret, not key_id/key_secret).
 */
function verifyRazorpaySignature(rawBody: Buffer, signature: string, secret: string): boolean {
  const expected = hmacSha256(rawBody.toString("utf8"), secret);
  return timingSafeEquals(signature, expected);
}

/**
 * Event-name heuristic for mandate/token confirmation, NOT an exhaustive,
 * independently-verified enum of Razorpay's real webhook event names —
 * flagged explicitly (see module header and RazorpayWebhookTokenEntity/
 * RazorpayWebhookSubscriptionEntity in @counter/razorpay-adapter's types.ts)
 * as needing verification against a
 * real Razorpay test-mode account before being fully trusted.
 */
function isMandateConfirmationEvent(eventName: string): boolean {
  return eventName.includes("token") || eventName.startsWith("subscription.activated");
}

function createRazorpayWebhookHandler(options: WebhookRoutesOptions): WebhookHandler {
  const deduplicator = new WebhookDeduplicator();

  return async (request: FastifyRequest, reply: FastifyReply): Promise<void> => {
    const rawBody = getRawBody(request);
    if (rawBody === undefined) {
      void reply
        .status(400)
        .send({ error: { code: "INVALID_FORMAT", message: "Missing raw request body" } });
      return;
    }

    const signature = requireHeaderString(request.headers, "x-razorpay-signature");
    if (signature === undefined) {
      void reply.status(401).send({
        error: { code: "UNAUTHENTICATED", message: "Missing X-Razorpay-Signature header" },
      });
      return;
    }

    if (!verifyRazorpaySignature(rawBody, signature, options.razorpayWebhookSecret)) {
      void reply.status(401).send({
        error: { code: "UNAUTHENTICATED", message: "Invalid Razorpay webhook signature" },
      });
      return;
    }

    let event: RazorpayWebhookEvent;
    try {
      event = JSON.parse(rawBody.toString("utf8")) as RazorpayWebhookEvent;
    } catch {
      void reply
        .status(400)
        .send({ error: { code: "INVALID_FORMAT", message: "Failed to parse webhook payload" } });
      return;
    }

    // Razorpay webhooks don't carry a single top-level event_id field the
    // way the payment/refund/order entities do their own `id` — use the
    // most specific entity id present as the dedup key, matching the
    // pattern webhook-processor.ts's own tests use.
    const eventId =
      event.payload.payment?.entity.id ??
      event.payload.refund?.entity.id ??
      event.payload.order?.entity.id ??
      event.payload.token?.entity.id ??
      event.payload.subscription?.entity.id ??
      `${event.event}:${String(event.created_at)}`;

    const outcome = processWebhookEvent(event, eventId, deduplicator, nowInstant());

    if (outcome.status === "duplicate") {
      void reply.status(200).send({ status: "already_processed" });
      return;
    }

    if (
      isMandateConfirmationEvent(event.event) &&
      options.recurringMandateProvisioner !== undefined
    ) {
      const tokenEntity = event.payload.token?.entity;
      if (tokenEntity !== undefined) {
        try {
          await options.recurringMandateProvisioner.confirmRegistrationFromWebhook({
            providerCustomerId: tokenEntity.customer_id,
            providerTokenId: tokenEntity.id,
          });
        } catch (error: unknown) {
          request.log.error(
            { err: error, eventId, eventType: event.event },
            "Razorpay mandate-confirmation webhook handler failed",
          );
        }
      }
    } else if (options.onRazorpayPaymentWebhook !== undefined) {
      try {
        await options.onRazorpayPaymentWebhook(event);
      } catch (error: unknown) {
        request.log.error(
          { err: error, eventId, eventType: event.event },
          "Razorpay payment webhook handler failed",
        );
      }
    }

    void reply.status(200).send({ status: "processed", eventId });
  };
}

// ─── Plugin ─────────────────────────────────────────────────────────────────

export async function webhookRoutesPlugin(
  fastify: FastifyInstance,
  options: WebhookRoutesOptions,
): Promise<void> {
  await webhookIngressPlugin(fastify, {
    adapters: new Map([
      ["shopify", createShopifyWebhookHandler(options)],
      ["razorpay", createRazorpayWebhookHandler(options)],
    ]),
  });
}
