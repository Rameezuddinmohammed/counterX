/**
 * Shared test support for the FEAT-003 adversarial / reliability integration
 * tests. NOT part of the production runtime — imported only by *.integration
 * .test.ts files. It centralizes the creds/DB gate, the idempotent runtime DDL
 * (so the durable ledger/kill-switch/inbox tables exist without migrating the
 * shared schema), a spy wrapper that records every Shopify effect (to prove
 * ZERO external effect on a denied checkout), and robust cleanup that cancels
 * real Shopify orders and deletes ONLY the test's own runtime rows.
 *
 * SECURITY: credentials are read from process.env only and never logged. SAFETY:
 * the DDL uses CREATE TABLE/INDEX IF NOT EXISTS and never drops or migrates the
 * shared schema; cleanup deletes only rows keyed on the test's unique key.
 */
import type { PostgresDatabase } from "@counter/data";
import type { ShopifyConnector } from "@counter/shopify-connector";

import { buildRealConnectorBundle } from "./boot.js";
import { requireRazorpayCredentials, requireShopifyCredentials } from "./connector-env.js";

export const databaseUrl =
  process.env["TEST_DATABASE_URL"]?.trim() || process.env["DATABASE_URL"]?.trim() || undefined;

export const hasCreds =
  (process.env["SHOPIFY_ACCESS_TOKEN"]?.trim() ?? "").length > 0 &&
  (process.env["RAZORPAY_KEY_ID"]?.trim() ?? "").length > 0 &&
  databaseUrl !== undefined;

/** Resolve the real connector bundle only under the gate (skips cleanly otherwise). */
export function realBundleOrNull(): ReturnType<typeof buildRealConnectorBundle> | null {
  if (!hasCreds) {
    return null;
  }
  const shopifyCreds = requireShopifyCredentials(process.env)!;
  const razorpayCreds = requireRazorpayCredentials(process.env)!;
  return buildRealConnectorBundle(shopifyCreds, razorpayCreds);
}

/** Idempotent DDL for the durable runtime tables the tests exercise. */
export const RUNTIME_DDL = `
  CREATE TABLE IF NOT EXISTS runtime.lifecycle_steps (
    id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
    environment platform.counter_environment NOT NULL,
    idempotency_key text NOT NULL,
    step text NOT NULL,
    status text NOT NULL,
    reference text,
    snapshot jsonb,
    created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
    completed_at timestamptz,
    CONSTRAINT lifecycle_steps_status CHECK (status IN ('completed', 'declined')),
    CONSTRAINT lifecycle_steps_step_not_empty CHECK (char_length(step) > 0),
    CONSTRAINT lifecycle_steps_key_not_empty CHECK (char_length(idempotency_key) > 0)
  );
  CREATE UNIQUE INDEX IF NOT EXISTS lifecycle_steps_natural_key
    ON runtime.lifecycle_steps (environment, idempotency_key, step);
`;

/** Count durable step-ledger rows recorded for an idempotency key. */
export async function ledgerRowCount(
  database: PostgresDatabase,
  idempotencyKey: string,
): Promise<number> {
  const result = await database.query<{ count: string }>(
    `SELECT count(*)::text AS count FROM runtime.lifecycle_steps WHERE idempotency_key = $1`,
    [idempotencyKey],
  );
  return Number.parseInt(result.rows[0]?.count ?? "0", 10);
}

/** A Shopify connector spy that records every effect invocation. */
export interface SpyConnector {
  readonly connector: ShopifyConnector;
  readonly calls: {
    draft: number;
    finalize: number;
    markPaid: number;
    query: number;
    cancel: number;
  };
}

/**
 * Wraps a real Shopify connector, incrementing a counter each time an effectful
 * action port is invoked. Used to PROVE that a denied checkout creates ZERO
 * external effect (the draft/finalize/mark-paid ports are never called).
 */
export function spyOnShopify(connector: ShopifyConnector): SpyConnector {
  const calls = { draft: 0, finalize: 0, markPaid: 0, query: 0, cancel: 0 };
  const wrap = <T extends { execute: (...args: never[]) => unknown }>(
    port: T,
    counter: keyof typeof calls,
  ): T => {
    // Bind execute to the ORIGINAL port so the action's `this` (client, etc.)
    // is preserved; only a call-count side effect is added.
    const boundExecute = (port.execute as (...a: never[]) => unknown).bind(port);
    return {
      ...port,
      execute: (...args: never[]) => {
        calls[counter] += 1;
        return boundExecute(...args);
      },
    } as T;
  };
  const spied: ShopifyConnector = {
    ...connector,
    draftOrderCreate: wrap(connector.draftOrderCreate, "draft"),
    orderFinalize: wrap(connector.orderFinalize, "finalize"),
    paymentRecord: wrap(connector.paymentRecord, "markPaid"),
    orderQuery: wrap(connector.orderQuery, "query"),
    orderCancel: wrap(connector.orderCancel, "cancel"),
  };
  return { connector: spied, calls };
}

/**
 * Cancels a real Shopify order (best-effort) via the connector's orderCancel
 * (which now carries the required restock:false arg) so the live store is left
 * clean. Never throws.
 */
export async function cancelShopifyOrder(
  connector: ShopifyConnector,
  orderId: string,
  idempotencyKey: string,
): Promise<void> {
  try {
    await connector.orderCancel.execute({
      payload: {
        orderId,
        reason: "OTHER",
        metadata: { correlationId: idempotencyKey, idempotencyKey },
      },
      idempotencyKey: `${idempotencyKey}-cancel`,
      correlationId: idempotencyKey,
      preconditions: [],
      timeoutMs: 20_000,
    });
  } catch {
    // best-effort cleanup; a failed cancel is surfaced by the post-suite re-query
  }
}
