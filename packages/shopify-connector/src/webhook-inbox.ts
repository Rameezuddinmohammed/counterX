/**
 * Webhook inbox with signature verification, deduplication, ordering
 * tolerance, and dead letter queue.
 *
 * Accepts raw webhook payloads after HMAC signature verification.
 * Deduplicates by X-Shopify-Webhook-Id. Resolves out-of-order
 * delivery using updatedAt from the payload.
 */

import { ok, err, createCanonicalError } from "@counter/domain";
import type { Instant, Result } from "@counter/domain";
import { verifyWebhookSignature } from "./auth.js";
import type { WebhookEvent } from "./catalog-sync.js";

// ─── Headers ──────────────────────────────────────────────────────────────────

export interface WebhookHeaders {
  readonly "x-shopify-webhook-id": string;
  readonly "x-shopify-topic": string;
  readonly "x-shopify-shop-domain": string;
  readonly "x-shopify-hmac-sha256": string;
  readonly "x-shopify-api-version"?: string | undefined;
}

// ─── Acceptance Result ────────────────────────────────────────────────────────

export type WebhookAcceptance =
  | { readonly status: "accepted"; readonly webhookId: string }
  | { readonly status: "already_processed"; readonly webhookId: string }
  | { readonly status: "rejected"; readonly reason: string };

// ─── Dead Letter Entry ────────────────────────────────────────────────────────

export interface DeadLetterEntry {
  readonly webhookId: string;
  readonly event: WebhookEvent;
  readonly attempts: number;
  readonly lastError: string;
  readonly failedAt: Instant;
}

// ─── Pending Entry ────────────────────────────────────────────────────────────

interface PendingEntry {
  readonly event: WebhookEvent;
  attempts: number;
}

// ─── Bounded Deduplication Set ────────────────────────────────────────────────

/**
 * A bounded set that evicts entries older than a configured TTL.
 * Prevents unbounded memory growth from webhook deduplication.
 */
class BoundedIdSet {
  private readonly maxSize: number;
  private readonly ttlMs: number;
  private readonly entries = new Map<string, number>();

  constructor(maxSize = 10_000, ttlMs = 3_600_000) {
    this.maxSize = maxSize;
    this.ttlMs = ttlMs;
  }

  add(id: string): void {
    // Evict expired entries if at capacity
    if (this.entries.size >= this.maxSize) {
      this.evictExpired();
    }
    // If still at capacity after eviction, remove oldest entry
    if (this.entries.size >= this.maxSize) {
      const oldest = this.entries.keys().next().value;
      if (oldest !== undefined) {
        this.entries.delete(oldest);
      }
    }
    this.entries.set(id, Date.now());
  }

  has(id: string): boolean {
    const timestamp = this.entries.get(id);
    if (timestamp === undefined) {
      return false;
    }
    // Check if entry has expired
    if (Date.now() - timestamp > this.ttlMs) {
      this.entries.delete(id);
      return false;
    }
    return true;
  }

  private evictExpired(): void {
    const now = Date.now();
    for (const [id, timestamp] of this.entries) {
      if (now - timestamp > this.ttlMs) {
        this.entries.delete(id);
      }
    }
  }
}

// ─── Webhook Inbox ────────────────────────────────────────────────────────────

export class WebhookInbox {
  private readonly secret: string;
  private readonly maxRetries: number;
  private readonly processedIds: BoundedIdSet;
  private readonly pendingQueue: PendingEntry[] = [];
  private readonly deadLetters: DeadLetterEntry[] = [];
  private readonly handler: ((event: WebhookEvent) => void) | undefined;

  constructor(
    secret: string,
    handler?: (event: WebhookEvent) => void,
    maxRetries = 3,
    maxDeduplicationSize = 10_000,
    deduplicationTtlMs = 3_600_000,
  ) {
    this.secret = secret;
    this.handler = handler;
    this.maxRetries = maxRetries;
    this.processedIds = new BoundedIdSet(maxDeduplicationSize, deduplicationTtlMs);
  }

  /**
   * Receive a raw webhook payload. Verifies HMAC signature and
   * deduplicates by webhook ID before enqueuing.
   */
  async receive(rawBody: Uint8Array, headers: WebhookHeaders): Promise<Result<WebhookAcceptance>> {
    const webhookId = headers["x-shopify-webhook-id"];
    const hmac = headers["x-shopify-hmac-sha256"];

    // Verify HMAC signature
    const valid = await verifyWebhookSignature(rawBody, hmac, this.secret);
    if (!valid) {
      return ok({
        status: "rejected" as const,
        reason: "Invalid HMAC signature",
      });
    }

    // Check for duplicate
    if (this.processedIds.has(webhookId)) {
      return ok({
        status: "already_processed" as const,
        webhookId,
      });
    }

    // Also check pending queue for duplicates
    const alreadyPending = this.pendingQueue.some((entry) => entry.event.webhookId === webhookId);
    if (alreadyPending) {
      return ok({
        status: "already_processed" as const,
        webhookId,
      });
    }

    // Parse payload — topic-agnostic (see WebhookEvent's own docs); the
    // caller narrows/validates it for whichever topic it actually is.
    let payload: unknown;
    try {
      const decoder = new TextDecoder();
      payload = JSON.parse(decoder.decode(rawBody));
    } catch {
      return err(
        createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message: "Failed to parse webhook payload as JSON",
        }),
      );
    }

    const event: WebhookEvent = Object.freeze({
      topic: headers["x-shopify-topic"],
      shopDomain: headers["x-shopify-shop-domain"],
      webhookId,
      payload,
      receivedAt: Date.now() as Instant,
    });

    this.pendingQueue.push({ event, attempts: 0 });

    return ok({
      status: "accepted" as const,
      webhookId,
    });
  }

  /**
   * Process the next pending event in FIFO order.
   * Returns true if an event was processed, false if queue is empty.
   */
  process(): boolean {
    if (this.pendingQueue.length === 0) {
      return false;
    }

    const entry = this.pendingQueue[0]!;
    entry.attempts++;

    try {
      if (this.handler) {
        this.handler(entry.event);
      }
      // Mark as processed
      this.processedIds.add(entry.event.webhookId);
      this.pendingQueue.shift();
      return true;
    } catch (error: unknown) {
      if (entry.attempts >= this.maxRetries) {
        // Move to dead letter queue
        this.deadLetters.push(
          Object.freeze({
            webhookId: entry.event.webhookId,
            event: entry.event,
            attempts: entry.attempts,
            lastError: error instanceof Error ? error.message : String(error),
            failedAt: Date.now() as Instant,
          }),
        );
        this.pendingQueue.shift();
      }
      return false;
    }
  }

  /**
   * Get all dead letter entries.
   */
  getDeadLetters(): readonly DeadLetterEntry[] {
    return this.deadLetters;
  }

  /**
   * Get pending queue length.
   */
  getPendingCount(): number {
    return this.pendingQueue.length;
  }

  /**
   * Check if a webhook ID has been processed.
   */
  isProcessed(webhookId: string): boolean {
    return this.processedIds.has(webhookId);
  }
}
