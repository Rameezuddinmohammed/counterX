/**
 * Razorpay webhook processor with deduplication and refund normalization.
 *
 * Handles:
 * - Event deduplication via event_id tracking
 * - Reorder tolerance (skips already-processed events)
 * - Refund status normalization to ProviderRefundEvidence
 */

import type { Instant } from "@counter/domain";
import { instantFromEpochMilliseconds } from "@counter/domain";

import type { ProviderRefundEvidence, ProviderRefundReference } from "@counter/payment-sdk";

import type { RazorpayRefund, RazorpayWebhookEvent } from "./types.js";
import { paiseToAmount } from "./types.js";

// ─── Event Deduplication ─────────────────────────────────────────────────────

export interface ProcessedEvent {
  readonly eventId: string;
  readonly eventType: string;
  readonly processedAt: Instant;
}

/**
 * Tracks processed webhook event_ids to prevent duplicate processing.
 */
export class WebhookDeduplicator {
  readonly #processed: Map<string, ProcessedEvent> = new Map();
  readonly #maxSize: number;

  public constructor(maxSize: number = 10_000) {
    this.#maxSize = maxSize;
  }

  /**
   * Checks whether an event has already been processed.
   */
  public isDuplicate(eventId: string): boolean {
    return this.#processed.has(eventId);
  }

  /**
   * Records an event as processed.
   * Evicts oldest entries when the store exceeds maxSize.
   */
  public record(eventId: string, eventType: string, processedAt: Instant): void {
    if (this.#processed.size >= this.#maxSize) {
      // Evict oldest entry (first inserted)
      const firstKey = this.#processed.keys().next().value;
      if (firstKey !== undefined) {
        this.#processed.delete(firstKey);
      }
    }

    this.#processed.set(
      eventId,
      Object.freeze({
        eventId,
        eventType,
        processedAt,
      }),
    );
  }

  /**
   * Returns the number of tracked events.
   */
  public get size(): number {
    return this.#processed.size;
  }

  /**
   * Checks if a specific event was processed.
   */
  public getProcessedEvent(eventId: string): ProcessedEvent | undefined {
    return this.#processed.get(eventId);
  }
}

// ─── Webhook Event Processing ────────────────────────────────────────────────

export type WebhookProcessingResult =
  | { readonly status: "processed"; readonly eventType: string; readonly eventId: string }
  | { readonly status: "duplicate"; readonly eventId: string }
  | { readonly status: "ignored"; readonly reason: string };

/**
 * Processes a verified Razorpay webhook event with deduplication.
 */
export function processWebhookEvent(
  event: RazorpayWebhookEvent,
  eventId: string,
  deduplicator: WebhookDeduplicator,
  processedAt: Instant,
): WebhookProcessingResult {
  // Check deduplication
  if (deduplicator.isDuplicate(eventId)) {
    return Object.freeze({ status: "duplicate" as const, eventId });
  }

  // Record as processed
  deduplicator.record(eventId, event.event, processedAt);

  return Object.freeze({
    status: "processed" as const,
    eventType: event.event,
    eventId,
  });
}

// ─── Refund Normalization ────────────────────────────────────────────────────

/**
 * Normalizes a Razorpay refund entity to ProviderRefundEvidence.
 * Maps Razorpay refund statuses:
 * - "processed" -> "confirmed"
 * - "pending" -> "pending"
 * - "failed" -> "declined"
 */
export function normalizeRefundEvidence(refund: RazorpayRefund): ProviderRefundEvidence {
  const reference = refund.id as unknown as ProviderRefundReference;
  const amount = paiseToAmount(refund.amount);

  const statusMap: Record<string, "confirmed" | "pending" | "declined"> = {
    processed: "confirmed",
    pending: "pending",
    failed: "declined",
  };

  const status = statusMap[refund.status] ?? "pending";

  const processedAt = status === "confirmed" ? toInstant(refund.created_at) : undefined;

  return Object.freeze({
    reference,
    status,
    amount,
    ...(processedAt !== undefined ? { processedAt } : {}),
  });
}

/**
 * Converts a Unix timestamp (seconds) to an Instant.
 */
function toInstant(unixSeconds: number): Instant | undefined {
  const result = instantFromEpochMilliseconds(unixSeconds * 1000);
  return result.ok ? result.value : undefined;
}
