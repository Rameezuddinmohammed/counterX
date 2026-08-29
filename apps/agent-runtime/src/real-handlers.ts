/**
 * Real (non-mock) implementations of the ten merchant runtime handler ports.
 *
 * Scope, deliberately: this wires the actual Shopify catalog, the actual
 * durable job queue the worker polls, the actual transaction read model, and
 * the actual Razorpay refund API — no hardcoded sample data. It does NOT
 * stand up the separate catalog-sync/webhook pipeline or the evidence ledger
 * that also exist in this codebase (see shopify-catalog.ts's header for why).
 *
 * transactionCreate is the keystone: it is the first thing in this codebase
 * that actually calls JobRepository.enqueue() for a transaction.lifecycle
 * job outside a test. Everything downstream (the worker's real lifecycle
 * handler, its durable step ledger, its projection store) already existed
 * and is exercised for real for the first time by this handler.
 *
 * SECURITY: never handles PAN, CVV, UPI PIN, or provider secrets — only
 * scope ids, opaque references, and minor-unit amounts.
 */
import type { Environment, Instant, IsoCurrencyCode } from "@counter/domain";
import { createCounterId } from "@counter/domain";
import type { TransactionalDatabase } from "@counter/data";
import { PostgresOutboxRepository, PostgresQuoteStore, PostgresStepLedger } from "@counter/data";
import type { AsyncJobRepository } from "@counter/data";
import type { ShopifyGraphQLPort } from "@counter/shopify-connector";
import type { ShopifyConnector } from "@counter/shopify-connector";
import type { RazorpayTestProvider } from "@counter/razorpay-adapter";
import { getCatalogVariant, searchCatalog } from "./shopify-catalog.js";
import { buildQuote } from "./quote-builder.js";
import {
  TransactionReadModel,
  STEP_CANCEL,
  STEP_MARK_PAID,
  STEP_REFUND,
} from "./transaction-read-model.js";
import type {
  CancelHandler,
  CapabilityHandler,
  MerchantHandlers,
  PaymentActionResultHandler,
  ProductHandler,
  QuoteHandler,
  ReceiptHandler,
  RefundHandler,
  SearchHandler,
  TransactionCreateHandler,
  TransactionStatusHandler,
} from "./merchant-handlers.js";

export interface RealHandlerDeps {
  readonly database: TransactionalDatabase;
  readonly environment: Environment;
  readonly shopify: ShopifyConnector;
  readonly jobRepository: AsyncJobRepository;
  /** Present only when Razorpay credentials are configured; gates the refund handler. */
  readonly razorpay: RazorpayTestProvider | undefined;
}

// ─── Shared formatting helpers ────────────────────────────────────────────────

function minorToDecimalString(minor: bigint | number): string {
  const value = typeof minor === "bigint" ? minor : BigInt(Math.trunc(minor));
  const negative = value < 0n;
  const abs = negative ? -value : value;
  const whole = abs / 100n;
  const fraction = (abs % 100n).toString().padStart(2, "0");
  return `${negative ? "-" : ""}${whole}.${fraction}`;
}

function errResult<E>(error: E): { readonly ok: false; readonly error: E } {
  return Object.freeze({ ok: false as const, error });
}

function okResult<V>(value: V): { readonly ok: true; readonly value: V } {
  return Object.freeze({ ok: true as const, value });
}

async function freshJobId() {
  const result = createCounterId("job", crypto.getRandomValues(new Uint8Array(16)));
  if (!result.ok) {
    throw new Error("Failed to derive job id");
  }
  return result.value;
}

// ─── Capability ────────────────────────────────────────────────────────────────

function createCapabilityHandler(shopify: ShopifyConnector): CapabilityHandler {
  return {
    async handle(ctx) {
      let connectorStatus: "connected" | "disconnected" | "degraded" = "connected";
      if (shopify.health !== undefined) {
        try {
          const check = await shopify.health.checkHealth();
          connectorStatus =
            check.status === "healthy"
              ? "connected"
              : check.status === "unhealthy"
                ? "disconnected"
                : "degraded";
        } catch {
          connectorStatus = "disconnected";
        }
      }
      return okResult({
        merchantId: ctx.merchantId,
        manifestDigest: "shopify-connector:2025-07",
        capabilities: ["search", "quote", "transaction", "cancel", "refund"] as readonly string[],
        connectorStatus,
        signature: "unsigned-pilot-manifest",
      });
    },
  };
}

// ─── Search / Product ──────────────────────────────────────────────────────────

function createSearchHandler(client: ShopifyGraphQLPort): SearchHandler {
  return {
    async handle(ctx, input) {
      const limit = input.pagination?.limit ?? 10;
      const variants = await searchCatalog(client, input.query, limit);
      return okResult({
        merchantId: ctx.merchantId,
        results: variants.map((variant) => ({
          variantId: variant.variantId,
          title: `${variant.productTitle} — ${variant.title}`,
          price: { amount: minorToDecimalString(variant.priceMinor), currency: variant.currency },
          available: variant.available,
        })),
        nextCursor: null,
        totalCount: variants.length,
      });
    },
  };
}

function createProductHandler(client: ShopifyGraphQLPort): ProductHandler {
  return {
    async handle(ctx, variantId) {
      const variant = await getCatalogVariant(client, variantId);
      if (variant === undefined) {
        return errResult({ kind: "not_found" as const });
      }
      return okResult({
        variantId: variant.variantId,
        merchantId: ctx.merchantId,
        title: `${variant.productTitle} — ${variant.title}`,
        description: variant.productDescription,
        price: { amount: minorToDecimalString(variant.priceMinor), currency: variant.currency },
        available: variant.available,
        version: "v1",
        freshness: new Date().toISOString(),
      });
    },
  };
}

// ─── Quote ───────────────────────────────────────────────────────────────────

function createQuoteHandler(
  client: ShopifyGraphQLPort,
  quoteStore: PostgresQuoteStore,
): QuoteHandler {
  return {
    async handle(ctx, input) {
      const variant = await getCatalogVariant(client, input.variantId);
      if (variant === undefined) {
        return errResult({ kind: "not_found" as const });
      }
      if (!variant.available) {
        return errResult({
          kind: "stale" as const,
          currentVersion: "unavailable",
          requestedVersion: "requested",
        });
      }

      const quote = buildQuote({
        merchantId: ctx.merchantId,
        variant,
        quantity: input.quantity,
        nowMs: Date.now(),
      });

      const saved = await quoteStore.save({
        id: quote.id,
        merchantId: ctx.merchantId,
        variantId: variant.variantId,
        quantity: input.quantity,
        unitPriceMinor: variant.priceMinor,
        totalPriceMinor: quote.totalPaise,
        currency: quote.currency,
        ctpDigest: quote.ctpDigest,
        quoteContent: quote,
        createdAt: new Date(quote.createdAt as unknown as number),
        expiresAt: new Date(quote.validUntil as unknown as number),
      });
      if (!saved.ok) {
        throw new Error(`Failed to persist quote: ${saved.error.message}`);
      }

      return okResult({
        quoteId: quote.id,
        merchantId: ctx.merchantId,
        variantId: variant.variantId,
        quantity: input.quantity,
        unitPrice: { amount: minorToDecimalString(variant.priceMinor), currency: variant.currency },
        totalPrice: { amount: minorToDecimalString(quote.totalPaise), currency: quote.currency },
        expiresAt: new Date(quote.validUntil as unknown as number).toISOString(),
        version: "v1",
      });
    },
  };
}

// ─── Transaction Create (the enqueue keystone) ─────────────────────────────────

const TRANSACTION_LIFECYCLE_JOB_TYPE = "transaction.lifecycle";

function createTransactionCreateHandler(
  database: TransactionalDatabase,
  environment: Environment,
  jobRepository: AsyncJobRepository,
): TransactionCreateHandler {
  const quoteStore = new PostgresQuoteStore(database, environment);

  return {
    async handle(ctx, input) {
      const quoteResult = await quoteStore.get(input.quoteId);
      if (!quoteResult.ok) {
        throw new Error(`Failed to load quote: ${quoteResult.error.message}`);
      }
      const quote = quoteResult.value;
      if (quote === undefined) {
        return errResult({
          kind: "stale" as const,
          currentVersion: "unknown",
          requestedVersion: input.quoteId,
        });
      }
      if (quote.merchantId !== ctx.merchantId) {
        // Cross-tenant: never distinguish "someone else's quote" from "not found".
        return errResult({ kind: "not_found" as const });
      }
      const now = Date.now();
      if (quote.expiresAt.getTime() <= now) {
        return errResult({
          kind: "stale" as const,
          currentVersion: "expired",
          requestedVersion: input.quoteId,
        });
      }

      const consumeResult = await quoteStore.markConsumed(input.quoteId);
      if (!consumeResult.ok) {
        throw new Error(`Failed to consume quote: ${consumeResult.error.message}`);
      }
      if (!consumeResult.value.consumed) {
        // Already spent against an earlier transaction — refuse reuse.
        return errResult({
          kind: "stale" as const,
          currentVersion: "consumed",
          requestedVersion: input.quoteId,
        });
      }

      const transactionIdResult = createCounterId(
        "transaction",
        crypto.getRandomValues(new Uint8Array(16)),
      );
      if (!transactionIdResult.ok) {
        throw new Error("Failed to derive transaction id");
      }
      const transactionId = transactionIdResult.value as unknown as string;

      const jobId = await freshJobId();
      const enqueueResult = await jobRepository.enqueue(
        {
          id: jobId,
          type: TRANSACTION_LIFECYCLE_JOB_TYPE,
          payload: {
            transactionId,
            amountMinor: Number(quote.totalPriceMinor),
            currency: quote.currency,
            variantId: quote.variantId,
            quantity: quote.quantity,
            authority: {
              quotedAmountMinor: Number(quote.totalPriceMinor),
              authorizationExpiresAtMs: quote.expiresAt.getTime(),
              authorizedMerchantId: ctx.merchantId,
            },
          },
          correlationId: undefined,
          availableAt: now as Instant,
          maxAttempts: 5,
        },
        now as Instant,
      );
      if (!enqueueResult.ok) {
        throw new Error(`Failed to enqueue transaction job: ${enqueueResult.error.message}`);
      }

      return okResult({
        transactionId,
        merchantId: ctx.merchantId,
        status: "pending" as const,
        quoteId: input.quoteId,
        amount: {
          amount: minorToDecimalString(quote.totalPriceMinor),
          currency: quote.currency,
        },
        createdAt: new Date(now).toISOString(),
        version: "v1",
      });
    },
  };
}

// ─── Transaction Status ─────────────────────────────────────────────────────────

function createTransactionStatusHandler(readModel: TransactionReadModel): TransactionStatusHandler {
  return {
    async handle(ctx, transactionId) {
      const record = await readModel.get(transactionId, ctx.merchantId);
      if (record === undefined) {
        return errResult({ kind: "not_found" as const });
      }
      return okResult({
        transactionId: record.transactionId,
        merchantId: record.merchantId,
        status: record.status,
        amount: { amount: minorToDecimalString(record.amountMinor), currency: record.currency },
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
        version: "v1",
      });
    },
  };
}

// ─── Payment Action Result ──────────────────────────────────────────────────────

/**
 * Durably records a caller-reported payment outcome as evidence (via the
 * outbox, alongside the worker's own receipt events). This does NOT
 * reconcile it against the transaction's authoritative state machine — the
 * worker's synchronous lifecycle handler is the only writer of that state.
 * Scope: an honest audit trail for an externally-reported result, not a
 * resumable async-payment flow (no such step exists in the current
 * connector bundle to resume).
 */
function createPaymentActionResultHandler(
  database: TransactionalDatabase,
  environment: Environment,
): PaymentActionResultHandler {
  const outbox = new PostgresOutboxRepository(database, environment);

  return {
    async handle(ctx, transactionId, input) {
      const status: "confirmed" | "failed" | "pending" =
        input.outcome === "success"
          ? "confirmed"
          : input.outcome === "failure"
            ? "failed"
            : "pending";
      const eventIdResult = createCounterId(
        "outbox-event",
        crypto.getRandomValues(new Uint8Array(16)),
      );
      if (!eventIdResult.ok) {
        throw new Error("Failed to derive outbox event id");
      }
      const now = Date.now();
      const appendResult = await outbox.append(
        [
          {
            id: eventIdResult.value,
            eventType: "payment.action-result.v1",
            eventVersion: 1,
            payload: {
              transactionId,
              merchantId: ctx.merchantId,
              providerReference: input.providerReference,
              outcome: input.outcome,
              providerMetadata: input.providerMetadata,
            },
            correlationId: undefined,
            idempotencyKey: `${transactionId}:payment-result:${input.providerReference}`,
          },
        ],
        now as Instant,
      );
      if (!appendResult.ok) {
        throw new Error(`Failed to record payment action result: ${appendResult.error.message}`);
      }
      return okResult({
        transactionId,
        status,
        providerReference: input.providerReference,
        processedAt: new Date(now).toISOString(),
      });
    },
  };
}

// ─── Cancel ──────────────────────────────────────────────────────────────────

function createCancelHandler(
  database: TransactionalDatabase,
  environment: Environment,
  shopify: ShopifyConnector,
): CancelHandler {
  const readModel = new TransactionReadModel(database, environment);
  const stepLedger = new PostgresStepLedger(database, environment);

  return {
    async handle(ctx, transactionId, input) {
      const record = await readModel.get(transactionId, ctx.merchantId);
      if (record === undefined) {
        return errResult({ kind: "not_found" as const });
      }

      const orderId = await readModel.stepReference(transactionId, STEP_MARK_PAID);
      if (orderId !== undefined) {
        const outcome = await shopify.orderCancel.execute({
          payload: {
            orderId,
            reason: input.reason,
            metadata: {
              correlationId: ctx.correlationId,
              idempotencyKey: `${transactionId}:cancel`,
            },
          },
          idempotencyKey: `${transactionId}:cancel`,
          correlationId: ctx.correlationId,
          preconditions: [],
          timeoutMs: 15_000,
        });
        if (outcome.status === "indeterminate") {
          return errResult({
            kind: "indeterminate" as const,
            correlationId: outcome.correlationId,
          });
        }
        if (outcome.status === "failed") {
          throw new Error(`Shopify order cancel failed: ${outcome.error.message}`);
        }
      }

      const now = Date.now() as Instant;
      const recorded = await stepLedger.record(
        transactionId,
        {
          step: STEP_CANCEL,
          status: "completed",
          reference: orderId,
          snapshot: { reason: input.reason },
        },
        now,
      );
      if (!recorded.ok) {
        throw new Error(`Failed to record cancellation: ${recorded.error.message}`);
      }

      return okResult({
        transactionId,
        status: "cancelled" as const,
        cancelledAt: new Date(now as unknown as number).toISOString(),
        version: "v2",
      });
    },
  };
}

// ─── Refund ──────────────────────────────────────────────────────────────────

function createRefundHandler(
  database: TransactionalDatabase,
  environment: Environment,
  razorpay: RazorpayTestProvider | undefined,
): RefundHandler {
  const readModel = new TransactionReadModel(database, environment);
  const stepLedger = new PostgresStepLedger(database, environment);
  const outbox = new PostgresOutboxRepository(database, environment);

  return {
    async handle(ctx, transactionId, input) {
      const record = await readModel.get(transactionId, ctx.merchantId);
      if (record === undefined) {
        return errResult({ kind: "not_found" as const });
      }
      if (razorpay === undefined) {
        throw new Error("Refund requires Razorpay credentials, which are not configured");
      }

      const receipt = await outbox.findByIdempotencyKey(transactionId, "transaction.receipt.v1");
      if (!receipt.ok) {
        throw new Error(`Failed to load receipt: ${receipt.error.message}`);
      }
      const providerReference =
        receipt.value !== undefined &&
        typeof receipt.value.payload === "object" &&
        receipt.value.payload !== null
          ? (receipt.value.payload as Record<string, unknown>)["providerReference"]
          : undefined;
      if (typeof providerReference !== "string" || providerReference.length === 0) {
        // No captured payment on record for this transaction — nothing to refund.
        return errResult({
          kind: "stale" as const,
          currentVersion: "no_captured_payment",
          requestedVersion: transactionId,
        });
      }

      const outcome = await razorpay.refund({
        reference: providerReference as unknown as Parameters<
          typeof razorpay.refund
        >[0]["reference"],
        amount: {
          amountMinor: BigInt(record.amountMinor),
          currency: record.currency as IsoCurrencyCode,
        },
        reason: input.reason,
        idempotencyKey: `${transactionId}:refund`,
      });

      if (outcome.kind === "indeterminate") {
        return errResult({ kind: "indeterminate" as const, correlationId: ctx.correlationId });
      }
      if (outcome.kind === "declined") {
        throw new Error(`Razorpay refund declined: ${outcome.reason.reason}`);
      }

      const now = Date.now() as Instant;
      const refundReference =
        outcome.kind === "confirmed" ? outcome.evidence.reference : providerReference;
      const recorded = await stepLedger.record(
        transactionId,
        {
          step: STEP_REFUND,
          status: "completed",
          reference: String(refundReference),
          snapshot: { reason: input.reason },
        },
        now,
      );
      if (!recorded.ok) {
        throw new Error(`Failed to record refund: ${recorded.error.message}`);
      }

      return okResult({
        refundId: String(refundReference),
        transactionId,
        status: "refunded" as const,
        refundedAt: new Date(now as unknown as number).toISOString(),
        amount: { amount: minorToDecimalString(record.amountMinor), currency: record.currency },
        version: "v2",
      });
    },
  };
}

// ─── Receipt ─────────────────────────────────────────────────────────────────

function createReceiptHandler(
  database: TransactionalDatabase,
  environment: Environment,
): ReceiptHandler {
  const readModel = new TransactionReadModel(database, environment);
  const outbox = new PostgresOutboxRepository(database, environment);

  return {
    async handle(ctx, transactionId) {
      const record = await readModel.get(transactionId, ctx.merchantId);
      if (record === undefined) {
        return errResult({ kind: "not_found" as const });
      }
      const receiptEvent = await outbox.findByIdempotencyKey(
        transactionId,
        "transaction.receipt.v1",
      );
      if (!receiptEvent.ok) {
        throw new Error(`Failed to load receipt: ${receiptEvent.error.message}`);
      }
      if (receiptEvent.value === undefined) {
        // The worker has not yet recorded a terminal receipt for this transaction.
        return errResult({ kind: "indeterminate" as const, correlationId: ctx.correlationId });
      }
      const payload = receiptEvent.value.payload as Record<string, unknown>;
      const signature =
        typeof payload["signedEvidence"] === "object" && payload["signedEvidence"] !== null
          ? Buffer.from(JSON.stringify(payload["signedEvidence"]))
              .toString("base64url")
              .slice(0, 44)
          : "unsigned";

      return okResult({
        receiptId: `rcpt_${transactionId}`,
        transactionId,
        merchantId: ctx.merchantId,
        issuedAt: record.updatedAt,
        items: [
          {
            variantId: "unknown",
            title: "Transaction total",
            quantity: 1,
            unitPrice: minorToDecimalString(record.amountMinor),
            total: minorToDecimalString(record.amountMinor),
          },
        ],
        total: { amount: minorToDecimalString(record.amountMinor), currency: record.currency },
        signature,
      });
    },
  };
}

// ─── Factory ─────────────────────────────────────────────────────────────────

export function createRealHandlers(deps: RealHandlerDeps): MerchantHandlers {
  return {
    capability: createCapabilityHandler(deps.shopify),
    search: createSearchHandler(deps.shopify.client),
    product: createProductHandler(deps.shopify.client),
    quote: createQuoteHandler(
      deps.shopify.client,
      new PostgresQuoteStore(deps.database, deps.environment),
    ),
    transactionCreate: createTransactionCreateHandler(
      deps.database,
      deps.environment,
      deps.jobRepository,
    ),
    transactionStatus: createTransactionStatusHandler(
      new TransactionReadModel(deps.database, deps.environment),
    ),
    paymentActionResult: createPaymentActionResultHandler(deps.database, deps.environment),
    cancel: createCancelHandler(deps.database, deps.environment, deps.shopify),
    refund: createRefundHandler(deps.database, deps.environment, deps.razorpay),
    receipt: createReceiptHandler(deps.database, deps.environment),
  };
}
