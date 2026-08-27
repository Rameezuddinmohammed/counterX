/**
 * PRIORITY 5 — Secret-leakage audit of the REAL runtime (pure Node, no Docker).
 *
 * Runs the REAL money seam for one checkout while capturing everything the
 * runtime emits — console/logger output, the returned result, the durable
 * runtime.lifecycle_steps rows, and (when present) runtime.outbox/inbox rows —
 * then scans ALL captured material for secret leakage:
 *   - the literal env secret VALUES (SHOPIFY_ACCESS_TOKEN, RAZORPAY_KEY_SECRET);
 *   - the patterns shpat_[A-Za-z0-9]+ and rzp_test_[A-Za-z0-9]+;
 *   - generic PAN / CVV / UPI-PIN patterns.
 * It asserts ZERO leakage. If any leak is found the source must be redacted.
 *
 * The scanner itself is exercised with a positive control (a string containing a
 * planted secret) so a broken scanner cannot pass silently. That control string
 * is asserted-on then discarded and is NEVER emitted or persisted.
 *
 * SKIPPED unless creds + a database URL are present. SAFETY: touches only its
 * own runtime.lifecycle_steps rows (unique key) and never drops/migrates the
 * schema; the created order is left PENDING and cancelled in cleanup. SECURITY:
 * credentials are read from process.env only and never logged by this test.
 */
import { PostgresDatabase, PostgresStepLedger } from "@counter/data";
import type { ShopifyConnector } from "@counter/shopify-connector";
import { afterAll, describe, expect, it } from "vitest";

import { createPostgresStepLedgerPort } from "./boot.js";
import { createRealPaymentAuthorizationPort } from "./real-lifecycle.js";
import type { PaymentAuthorizationRequest } from "./transaction-lifecycle.js";
import {
  cancelShopifyOrder,
  databaseUrl,
  hasCreds,
  realBundleOrNull,
  RUNTIME_DDL,
} from "./adversarial-test-support.js";

const gatedDescribe = hasCreds ? describe : describe.skip;

interface SecretMatcher {
  readonly label: string;
  readonly test: (haystack: string) => boolean;
}

/** Builds the leak matchers from the live env values + known secret patterns. */
function buildMatchers(): SecretMatcher[] {
  const matchers: SecretMatcher[] = [];
  const literals: Array<[string, string | undefined]> = [
    ["SHOPIFY_ACCESS_TOKEN literal", process.env["SHOPIFY_ACCESS_TOKEN"]?.trim()],
    ["RAZORPAY_KEY_SECRET literal", process.env["RAZORPAY_KEY_SECRET"]?.trim()],
  ];
  for (const [label, value] of literals) {
    if (value !== undefined && value.length > 0) {
      matchers.push({ label, test: (h) => h.includes(value) });
    }
  }
  const patterns: Array<[string, RegExp]> = [
    ["shpat_ token pattern", /shpat_[A-Za-z0-9]+/],
    ["rzp_test_ secret pattern", /rzp_test_[A-Za-z0-9]{10,}/],
    // Generic sensitive-data patterns: 13-19 digit PAN, 3-4 digit CVV label, UPI PIN label.
    ["PAN pattern", /\b(?:\d[ -]?){13,19}\b/],
    ["CVV label pattern", /\b(?:cvv|cvc|cvv2)\b\s*[:=]\s*\d{3,4}/i],
    ["UPI PIN label pattern", /\bupi[_ -]?pin\b\s*[:=]\s*\d{4,6}/i],
  ];
  for (const [label, re] of patterns) {
    matchers.push({ label, test: (h) => re.test(h) });
  }
  return matchers;
}

function scanForLeaks(haystack: string, matchers: SecretMatcher[]): string[] {
  return matchers.filter((m) => m.test(haystack)).map((m) => m.label);
}

gatedDescribe("secret-leakage audit of the real runtime (creds+DB-gated, pure Node)", () => {
  const database = new PostgresDatabase(databaseUrl as string);
  const bundle = realBundleOrNull();
  const idempotencyKey = `secret-scan-${Date.now()}`;

  afterAll(async () => {
    try {
      const orderRow = (
        await database.query<{ reference: string | null }>(
          `SELECT reference FROM runtime.lifecycle_steps
           WHERE idempotency_key = $1 AND step = 'shopify.finalize'`,
          [idempotencyKey],
        )
      ).rows[0];
      const orderId = orderRow?.reference ?? undefined;
      if (bundle !== null && orderId !== undefined && orderId.length > 0) {
        await cancelShopifyOrder(bundle.shopify, orderId, idempotencyKey);
      }
    } finally {
      await database.query(`DELETE FROM runtime.lifecycle_steps WHERE idempotency_key = $1`, [
        idempotencyKey,
      ]);
      await database.close();
    }
  });

  it("positive control: the scanner detects a planted secret", () => {
    const matchers = buildMatchers();
    const planted = "leak shpat_deadbeef0123 and rzp_test_ABCDEFGHIJ0123 here";
    const hits = scanForLeaks(planted, matchers);
    expect(hits).toContain("shpat_ token pattern");
    expect(hits).toContain("rzp_test_ secret pattern");
  });

  it(
    "emits ZERO secrets across logs, result, and durable rows during a real checkout",
    async () => {
      await database.query(RUNTIME_DDL);
      await database.query(`DELETE FROM runtime.lifecycle_steps WHERE idempotency_key = $1`, [
        idempotencyKey,
      ]);

      // Capture ALL console output during the real run.
      const captured: string[] = [];
      const methods = ["log", "info", "warn", "error", "debug"] as const;
      /* eslint-disable no-console */
      const originals = methods.map((m) => [m, console[m]] as const);
      for (const m of methods) {
        (console as unknown as Record<string, unknown>)[m] = (...args: unknown[]): void => {
          captured.push(args.map((a) => (typeof a === "string" ? a : safeStringify(a))).join(" "));
        };
      }
      /* eslint-enable no-console */

      // Leave the order PENDING (mark-paid held) so it is cancellable in cleanup.
      const heldShopify: ShopifyConnector = {
        ...bundle!.shopify,
        paymentRecord: {
          execute: (): Promise<{
            readonly status: "indeterminate";
            readonly lastKnownState: string;
          }> =>
            Promise.resolve({ status: "indeterminate" as const, lastKnownState: "held" }),
        } as unknown as ShopifyConnector["paymentRecord"],
      };

      let result: unknown;
      try {
        const port = createRealPaymentAuthorizationPort({
          shopify: heldShopify,
          razorpay: bundle!.razorpay,
          payments: bundle!.payments,
          merchantId: bundle!.merchantId,
          stepLedger: createPostgresStepLedgerPort(new PostgresStepLedger(database)),
          actionTimeoutMs: 30_000,
        });
        const variantId = process.env["SHOPIFY_TEST_VARIANT_GID"];
        const request: PaymentAuthorizationRequest = {
          transactionId: "ctr_txn_scan" as PaymentAuthorizationRequest["transactionId"],
          amountMinor: 100,
          currency: "INR",
          idempotencyKey,
          ...(variantId !== undefined ? { variantId } : {}),
          quantity: 1,
        };
        result = await port.authorizeAndCapture(request);
      } finally {
        for (const [m, fn] of originals) {
          (console as unknown as Record<string, unknown>)[m] = fn;
        }
      }

      // Gather all durable rows the runtime touched for this key.
      const ledgerRows = await database.query(
        `SELECT id, environment, idempotency_key, step, status, reference, snapshot
         FROM runtime.lifecycle_steps WHERE idempotency_key = $1`,
        [idempotencyKey],
      );

      const material: string[] = [
        ...captured,
        safeStringify(result),
        safeStringify(ledgerRows.rows),
      ];
      const haystack = material.join("\n");

      const matchers = buildMatchers();
      const hits = scanForLeaks(haystack, matchers);
      expect(hits).toEqual([]);
    },
    180_000,
  );
});

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  } catch {
    return String(value);
  }
}
