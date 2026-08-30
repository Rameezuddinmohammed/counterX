/**
 * Real (non-mock) implementations of the ten merchant runtime handler ports.
 *
 * Scope, deliberately: this wires the actual Shopify catalog, the actual
 * durable job queue the worker polls, and the actual transaction read model —
 * no hardcoded sample data. It does NOT stand up the separate
 * catalog-sync/webhook pipeline or the evidence ledger that also exist in
 * this codebase (see shopify-catalog.ts's header for why).
 *
 * REFUND IS A RELAY, NOT AN IMMEDIATE EXECUTION: createRefundHandler below
 * only records a pending runtime.refund_requests row (migration 0014) — it
 * does NOT call Razorpay. The actual provider call happens only once the
 * merchant approves, in apps/control-plane-api/src/refund-request-store.ts.
 * This app therefore no longer needs Razorpay credentials for anything (see
 * main.ts).
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
import type { Environment, Instant } from "@counter/domain";
import { createCounterId } from "@counter/domain";
import type { TransactionalDatabase } from "@counter/data";
import { PostgresOutboxRepository, PostgresQuoteStore, PostgresStepLedger } from "@counter/data";
import type { AsyncJobRepository } from "@counter/data";
import type { ShopifyGraphQLPort } from "@counter/shopify-connector";
import type { ShopifyConnector } from "@counter/shopify-connector";
import { isCtpEnvelope, verifyEnvelope } from "@counter/trust-protocol";
import { getCatalogVariant, searchCatalog } from "./shopify-catalog.js";
import { buildQuote } from "./quote-builder.js";
import { PostgresCtpKeyRegistry } from "./ctp-key-registry.js";
import { TransactionReadModel, STEP_CANCEL, STEP_MARK_PAID } from "./transaction-read-model.js";
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
        // A real buyer's signed purchase intent must bind to this exact
        // value (payload.quote_digest) — without it in the response, a
        // caller has no way to construct a matching signature at all.
        quoteDigest: quote.ctpDigest,
        version: "v1",
      });
    },
  };
}

// ─── Transaction Create (the enqueue keystone) ─────────────────────────────────

const TRANSACTION_LIFECYCLE_JOB_TYPE = "transaction.lifecycle";

/** CTP protocol environment for verifying buyer-signed envelopes (a separate vocabulary from the platform Environment — see @counter/trust-protocol's CtpEnvironment). */
const CTP_VERIFICATION_ENVIRONMENT = "sandbox";

function createTransactionCreateHandler(
  database: TransactionalDatabase,
  environment: Environment,
  jobRepository: AsyncJobRepository,
): TransactionCreateHandler {
  const quoteStore = new PostgresQuoteStore(database, environment);
  const ctpKeyRegistry = new PostgresCtpKeyRegistry(database, environment);

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

      // When the caller attached a CTP-signed purchase-intent envelope (a
      // real buyer agent, not a merchant-only/test flow), verify it BEFORE
      // consuming the quote: a failed/tampered signature must not burn the
      // quote and deny the legitimate buyer a chance to retry.
      let buyerWalletId: string | undefined;
      if (input.ctpEnvelope !== undefined) {
        if (!isCtpEnvelope(input.ctpEnvelope)) {
          return errResult({ kind: "unauthorized" as const, reason: "Malformed signed envelope" });
        }
        const verifyResult = await verifyEnvelope(input.ctpEnvelope, {
          keyRegistry: ctpKeyRegistry,
          currentTime: new Date(now).toISOString(),
          expectedAudience: ctx.merchantId,
          expectedEnvironment: CTP_VERIFICATION_ENVIRONMENT,
        });
        if (!verifyResult.ok) {
          return errResult({ kind: "unauthorized" as const, reason: verifyResult.error.message });
        }
        const payload = input.ctpEnvelope.payload;
        // Binds the signature to THIS specific quote — closes the door on a
        // validly-signed envelope for a different purchase being replayed
        // against this one.
        if (payload.quote_id !== input.quoteId || payload.quote_digest !== quote.ctpDigest) {
          return errResult({
            kind: "stale" as const,
            currentVersion: quote.ctpDigest,
            requestedVersion: payload.quote_digest,
          });
        }
        buyerWalletId = payload.wallet_id;
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
              // A real buyer's wallet id (from their verified signed intent)
              // when present, so the worker's rolling 24h spend ledger
              // enforces THEIR limit — otherwise a stable per-merchant wallet
              // id so it still accumulates across that merchant's
              // transactions instead of each one getting its own one-shot
              // bucket (which would make the rolling-total ceiling a no-op).
              walletId: buyerWalletId ?? ctx.merchantId,
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

// ─── Refund (a RELAY — records the request; never calls Razorpay itself) ──────

/** Postgres unique_violation — used to detect an already-pending refund request. */
function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}

function createRefundHandler(
  database: TransactionalDatabase,
  environment: Environment,
): RefundHandler {
  const readModel = new TransactionReadModel(database, environment);
  const outbox = new PostgresOutboxRepository(database, environment);

  return {
    async handle(ctx, transactionId, input) {
      const record = await readModel.get(transactionId, ctx.merchantId);
      if (record === undefined) {
        return errResult({ kind: "not_found" as const });
      }

      // A refund request only makes sense against a transaction that was
      // actually captured — reuses the same receipt lookup the (now
      // superseded) immediate-refund path used, so this check is unchanged.
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

      const idResult = createCounterId(
        "refund-request",
        crypto.getRandomValues(new Uint8Array(16)),
      );
      if (!idResult.ok) {
        throw new Error("Failed to derive a refund-request id");
      }
      const refundRequestId = idResult.value as unknown as string;
      const now = new Date().toISOString();

      try {
        await database.query(
          `INSERT INTO runtime.refund_requests (
             id, environment, transaction_id, merchant_id, requested_amount_minor,
             currency, reason, status, requested_at, created_at, updated_at
           ) VALUES ($1, $2, $3, $4, $5, $6, $7, 'pending', $8, $8, $8)`,
          [
            refundRequestId,
            environment,
            transactionId,
            ctx.merchantId,
            record.amountMinor,
            record.currency,
            input.reason,
            now,
          ],
        );
      } catch (error) {
        if (isUniqueViolation(error)) {
          // A pending refund request already exists for this transaction —
          // the merchant has not yet decided on it.
          return errResult({
            kind: "stale" as const,
            currentVersion: "refund_already_pending",
            requestedVersion: transactionId,
          });
        }
        throw error;
      }

      return okResult({
        refundRequestId,
        transactionId,
        status: "pending" as const,
        requestedAt: now,
        amount: { amount: minorToDecimalString(record.amountMinor), currency: record.currency },
        version: "v3",
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
    refund: createRefundHandler(deps.database, deps.environment),
    receipt: createReceiptHandler(deps.database, deps.environment),
  };
}
