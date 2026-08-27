/**
 * Merchant transaction read-model routes for the control plane API.
 *
 * Exposes two GET endpoints that satisfy the ALREADY-DEFINED merchant-console
 * api-client signatures (see apps/merchant-console/src/lib/api-client.ts):
 *
 *   GET /control/v1/merchants/:merchantId/transactions -> readonly Transaction[]
 *   GET /control/v1/transactions/:transactionId        -> Transaction
 *
 * The response bodies are the RAW JSON arrays/objects (no envelope), because the
 * api-client parses `response.json()` directly into `readonly Transaction[]` and
 * `Transaction`.
 *
 * ---------------------------------------------------------------------------
 * READ MODEL (assembled from the runtime.* tables)
 * ---------------------------------------------------------------------------
 * SPINE   : runtime.workflow_intents, filtered to environment + scope_kind
 *           = 'merchant' + scope_id = <merchantId>. Provides transactionId
 *           (= transaction_id), merchantId (= scope_id), createdAt (= created_at)
 *           and the intent status used as one input to state derivation.
 * STATE / TRANSITIONS : ordered runtime.lifecycle_steps joined by
 *           idempotency_key = workflow_intents.transaction_id. The worker's real
 *           lifecycle (apps/worker/src/real-lifecycle.ts) drives three external
 *           Shopify legs recorded as steps 'shopify.draft', 'shopify.finalize'
 *           and 'shopify.markPaid' (status 'completed' | 'declined'), each with a
 *           provider reference. A '<step>.claim' row is a durable pre-claim guard
 *           and is NOT a user-visible transition, so .claim rows are excluded.
 * AMOUNT  : runtime.spend_ledger joined by reference = transaction_id. The ledger
 *           stores amount_minor (INTEGER minor units); the front-end Transaction
 *           amount is in MAJOR units, so we divide by 100 (INR has 2 minor
 *           digits; demo showed amount:1500 rendered as "INR 1,500").
 *
 * ---------------------------------------------------------------------------
 * DOCUMENTED GAPS (do NOT fabricate values)
 * ---------------------------------------------------------------------------
 * buyerRef : no buyer-identity column is persisted today. We read it from
 *            workflow_intents.authority_context->>'buyerRef' if present, else
 *            emit the explicit placeholder BUYER_REF_UNAVAILABLE.
 * method   : no payment-method column is persisted today (lifecycle_steps.snapshot
 *            is currently always null). We read authority_context->>'method' if
 *            present, else emit the explicit placeholder METHOD_UNKNOWN.
 * These gaps are recorded in the feature findings.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getActorContext, registerRoutePermission } from "@counter/http-api-kit";

// ---------------------------------------------------------------------------
// API-layer types — MUST match apps/merchant-console/src/lib/types.ts exactly.
// ---------------------------------------------------------------------------

export type TransactionState =
  | "initiated"
  | "authorized"
  | "captured"
  | "settled"
  | "refunded"
  | "failed"
  | "disputed";

export interface TransactionStateTransition {
  readonly from: TransactionState | null;
  readonly to: TransactionState;
  readonly timestamp: string;
  readonly actor: string;
  readonly evidenceRef: string | null;
}

export interface Transaction {
  readonly transactionId: string;
  readonly merchantId: string;
  readonly amount: number;
  readonly currency: "INR";
  readonly currentState: TransactionState;
  readonly buyerRef: string;
  readonly method: string;
  readonly createdAt: string;
  readonly transitions: readonly TransactionStateTransition[];
}

/** Explicit placeholders for the documented, currently-unpersisted gaps. */
export const BUYER_REF_UNAVAILABLE = "(unavailable)";
export const METHOD_UNKNOWN = "unknown";

// ---------------------------------------------------------------------------
// Derivation building blocks (pure, documented)
// ---------------------------------------------------------------------------

/** Lifecycle-step shape consumed by the derivation functions. */
export interface OrderedStep {
  readonly step: string;
  /**
   * Lifecycle status of the step. Known values include "completed" and
   * "declined", but the read-model surfaces the raw stored value, so this is
   * typed as `string` to avoid a misleading union that collapses to `string`.
   */
  readonly status: string;
  readonly reference: string | null;
  /** ISO-8601 timestamp for when the step was recorded. */
  readonly timestamp: string;
}

const STEP_DRAFT = "shopify.draft";
const STEP_FINALIZE = "shopify.finalize";
const STEP_MARK_PAID = "shopify.markPaid";

/** True for the durable pre-claim guard rows, which are NOT user-visible. */
export function isClaimStep(step: string): boolean {
  return step.endsWith(".claim");
}

/**
 * deriveTransactionState — maps the intent status + ordered lifecycle steps to
 * the terminal TransactionState.
 *
 * Rules (grounded in apps/worker/src/real-lifecycle.ts semantics):
 *   - intent.status === 'failed'                => 'failed'
 *   - any step with status 'declined'           => 'failed'
 *   - completed shopify.markPaid                 => 'settled'
 *   - else completed shopify.finalize            => 'captured'
 *   - else completed shopify.draft               => 'authorized'
 *   - else (intent exists, no completed leg yet) => 'initiated'
 *
 * NOTE: 'refunded' and 'disputed' are part of the front-end union but have no
 * persisted source in the current lifecycle, so they are never derived here.
 */
export function deriveTransactionState(
  intentStatus: string,
  orderedSteps: readonly OrderedStep[],
): TransactionState {
  const visible = orderedSteps.filter((s) => !isClaimStep(s.step));

  if (intentStatus === "failed") {
    return "failed";
  }
  if (visible.some((s) => s.status === "declined")) {
    return "failed";
  }
  const completed = new Set(visible.filter((s) => s.status === "completed").map((s) => s.step));
  if (completed.has(STEP_MARK_PAID)) {
    return "settled";
  }
  if (completed.has(STEP_FINALIZE)) {
    return "captured";
  }
  if (completed.has(STEP_DRAFT)) {
    return "authorized";
  }
  return "initiated";
}

/** The actor attributed to a step. shopify.* steps are driven by 'shopify'. */
function actorForStep(step: string): string {
  if (step.startsWith("shopify.")) {
    return "shopify";
  }
  return "system";
}

/** Maps a single completed step to the TransactionState it lands the txn in. */
function stateForCompletedStep(step: string): TransactionState | null {
  switch (step) {
    case STEP_DRAFT:
      return "authorized";
    case STEP_FINALIZE:
      return "captured";
    case STEP_MARK_PAID:
      return "settled";
    default:
      return null;
  }
}

/**
 * buildTransitions — builds the ordered, user-visible transition list.
 *
 * Always anchors with a synthetic 'initiated' transition at the intent's
 * created_at (from=null, to='initiated', actor='system'). Then, for each
 * ordered NON-claim lifecycle step:
 *   - a 'completed' shopify leg emits a transition into its target state
 *     (authorized/captured/settled), carrying the step reference as evidenceRef;
 *   - a 'declined' step emits a transition into 'failed'.
 * The `from` of each transition is the `to` of the previous one.
 */
export function buildTransitions(
  orderedSteps: readonly OrderedStep[],
  intentCreatedAt: string,
): TransactionStateTransition[] {
  const transitions: TransactionStateTransition[] = [];
  let previous: TransactionState = "initiated";

  transitions.push({
    from: null,
    to: "initiated",
    timestamp: intentCreatedAt,
    actor: "system",
    evidenceRef: null,
  });

  for (const step of orderedSteps) {
    if (isClaimStep(step.step)) {
      continue;
    }
    let to: TransactionState | null = null;
    if (step.status === "declined") {
      to = "failed";
    } else if (step.status === "completed") {
      to = stateForCompletedStep(step.step);
    }
    if (to === null) {
      continue;
    }
    transitions.push({
      from: previous,
      to,
      timestamp: step.timestamp,
      actor: actorForStep(step.step),
      evidenceRef: step.reference,
    });
    previous = to;
  }

  return transitions;
}

// ---------------------------------------------------------------------------
// Store PORT
// ---------------------------------------------------------------------------

export interface TransactionListOptions {
  readonly limit: number;
  readonly offset: number;
}

/**
 * A store row bundles the assembled Transaction with its OWNING merchantId so
 * the route layer can enforce tenant scope on getTransaction(id) even though
 * the caller supplies only the transaction id.
 */
export interface OwnedTransaction {
  readonly merchantId: string;
  readonly transaction: Transaction;
}

export interface TransactionReadStore {
  list(
    merchantId: string,
    options: TransactionListOptions,
    environment: string,
  ): Promise<readonly Transaction[]>;
  get(transactionId: string, environment: string): Promise<OwnedTransaction | undefined>;
}

// ---------------------------------------------------------------------------
// In-memory store (local / test / development)
// ---------------------------------------------------------------------------

export function createInMemoryTransactionStore(
  seed: readonly Transaction[] = [],
): TransactionReadStore {
  const byMerchant = new Map<string, Transaction[]>();
  const byId = new Map<string, Transaction>();

  for (const txn of seed) {
    const list = byMerchant.get(txn.merchantId) ?? [];
    list.push(txn);
    byMerchant.set(txn.merchantId, list);
    byId.set(txn.transactionId, txn);
  }

  // newest-first, mirroring the Postgres ORDER BY created_at DESC.
  for (const list of byMerchant.values()) {
    list.sort((a, b) => (a.createdAt < b.createdAt ? 1 : a.createdAt > b.createdAt ? -1 : 0));
  }

  return {
    list(merchantId, options, _environment): Promise<readonly Transaction[]> {
      const all = byMerchant.get(merchantId) ?? [];
      const start = Math.max(0, options.offset);
      const end = start + Math.max(0, options.limit);
      return Promise.resolve(all.slice(start, end));
    },
    get(transactionId, _environment): Promise<OwnedTransaction | undefined> {
      const txn = byId.get(transactionId);
      if (txn === undefined) {
        return Promise.resolve(undefined);
      }
      return Promise.resolve({ merchantId: txn.merchantId, transaction: txn });
    },
  };
}

// ---------------------------------------------------------------------------
// Query parsing
// ---------------------------------------------------------------------------

const DEFAULT_LIMIT = 50;
const MAX_LIMIT = 200;
const DEFAULT_OFFSET = 0;

export function parseListOptions(query: Record<string, unknown>): TransactionListOptions {
  const limit = clampInteger(query["limit"], DEFAULT_LIMIT, 1, MAX_LIMIT);
  const offset = clampInteger(query["offset"], DEFAULT_OFFSET, 0, Number.MAX_SAFE_INTEGER);
  return { limit, offset };
}

function clampInteger(raw: unknown, fallback: number, min: number, max: number): number {
  if (raw === undefined || raw === null || raw === "") {
    return fallback;
  }
  const parsed = typeof raw === "number" ? raw : Number(raw);
  if (!Number.isFinite(parsed) || !Number.isInteger(parsed)) {
    return fallback;
  }
  return Math.min(max, Math.max(min, parsed));
}

// ---------------------------------------------------------------------------
// Tenant isolation — identical semantics to policy-routes.ts.
// ---------------------------------------------------------------------------

function verifyTenantAccess(request: FastifyRequest, merchantId: string): boolean {
  const actorContext = getActorContext(request);
  if (actorContext === undefined) {
    return false;
  }
  const scope = actorContext.scope;
  if (scope.kind === "platform") {
    return true;
  }
  if (scope.kind === "merchant") {
    return scope.merchantId === merchantId;
  }
  return false;
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export interface TransactionRoutesOptions {
  readonly store: TransactionReadStore;
  readonly environment: string;
}

const LIST_ROUTE = "/control/v1/merchants/:merchantId/transactions";
const GET_ROUTE = "/control/v1/transactions/:transactionId";

export async function transactionRoutesPlugin(
  fastify: FastifyInstance,
  options: TransactionRoutesOptions,
): Promise<void> {
  const { store, environment } = options;

  registerRoutePermission(`GET:${LIST_ROUTE}`, { permission: "identity.scope.read" });
  registerRoutePermission(`GET:${GET_ROUTE}`, { permission: "identity.scope.read" });

  // GET list — merchant-scoped, tenant isolation enforced up-front.
  fastify.get(LIST_ROUTE, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as Record<string, string>;
    const merchantId = params["merchantId"] ?? "";

    if (!verifyTenantAccess(request, merchantId)) {
      void reply.status(403).send({
        error: { code: "FORBIDDEN", message: "Access denied for the requested merchant" },
      });
      return;
    }

    const query = (request.query ?? {}) as Record<string, unknown>;
    const listOptions = parseListOptions(query);
    const transactions = await store.list(merchantId, listOptions, environment);
    void reply.send(transactions);
  });

  // GET single — resolve first, then enforce tenant scope against the OWNING
  // merchant so a merchant cannot read another merchant's transaction by id.
  fastify.get(GET_ROUTE, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as Record<string, string>;
    const transactionId = params["transactionId"] ?? "";

    const owned = await store.get(transactionId, environment);
    if (owned === undefined) {
      void reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Transaction not found" },
      });
      return;
    }

    if (!verifyTenantAccess(request, owned.merchantId)) {
      // Do not disclose existence of another merchant's transaction.
      void reply.status(404).send({
        error: { code: "NOT_FOUND", message: "Transaction not found" },
      });
      return;
    }

    void reply.send(owned.transaction);
  });
}
