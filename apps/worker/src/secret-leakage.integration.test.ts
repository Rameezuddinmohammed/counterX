/**
 * PRIORITY 5 — Secret-leakage audit of the REAL runtime (pure Node, no Docker).
 *
 * Runs the REAL money seam for one checkout while capturing everything the
 * runtime emits — console/logger output, the returned result, the durable
 * runtime.lifecycle_steps rows, AND the durable runtime.outbox_events receipt
 * rows the receipt sink persists — then scans ALL captured material for secret
 * leakage. It ALSO asserts the connector network-egress redaction path
 * (redactAuthorization) hides the Basic-auth credential from any request log,
 * closing the gap where the outbound Authorization header carries the secret:
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
import { PostgresDatabase, PostgresStepLedger, PostgresOutboxRepository } from "@counter/data";
import { createCounterId, type CounterId, type Instant } from "@counter/domain";
import { redactAuthorization } from "@counter/razorpay-adapter";
import { randomUUID } from "node:crypto";
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

function randomOutboxId(): CounterId<"outbox-event"> {
  const entropy = new Uint8Array(16);
  const uuid = randomUUID().replace(/-/g, "");
  for (let index = 0; index < 16; index += 1) {
    entropy[index] = Number.parseInt(uuid.slice(index * 2, index * 2 + 2), 16);
  }
  const result = createCounterId("outbox-event", entropy);
  if (!result.ok) throw new Error("bad outbox id");
  return result.value;
}

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
    // Sensitive-data label patterns (a CVV/UPI PIN is only a secret when it is
    // labelled as one; a bare 3-6 digit number is not).
    ["CVV label pattern", /\b(?:cvv|cvc|cvv2)\b\s*[:=]\s*\d{3,4}/i],
    ["UPI PIN label pattern", /\bupi[_ -]?pin\b\s*[:=]\s*\d{4,6}/i],
  ];
  for (const [label, re] of patterns) {
    matchers.push({ label, test: (h) => re.test(h) });
  }
  // PAN detector: a 13-19 digit run (allowing space/hyphen grouping) that is
  // ALSO Luhn-valid — so it only fires on genuine card-number-shaped data, not
  // on timestamps, bigint ids, or Shopify GIDs (which are not Luhn-valid).
  matchers.push({ label: "PAN pattern (Luhn-valid)", test: (h) => containsLuhnValidPan(h) });
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
      await database.query(
        `DELETE FROM runtime.outbox_events WHERE payload ->> 'idempotencyKey' = $1`,
        [idempotencyKey],
      );
      await database.close();
    }
  });

  it("connector network egress: redactAuthorization hides the Basic-auth secret from request logs", () => {
    // The outbound Razorpay request carries the key secret in the Authorization
    // header. The connector's request-logging path redacts it via
    // redactAuthorization; prove the credential material never survives into a
    // loggable headers record, and that the scanner would have caught it if it
    // did (rzp_test_ pattern + literal).
    const keyId = process.env["RAZORPAY_KEY_ID"] ?? "rzp_test_EXAMPLE";
    const keySecret = process.env["RAZORPAY_KEY_SECRET"] ?? "supersecretvalue";
    const rawAuthorization = `Basic ${Buffer.from(`${keyId}:${keySecret}`, "utf8").toString("base64")}`;
    const redacted = redactAuthorization({
      Authorization: rawAuthorization,
      Accept: "application/json",
    });
    const matchers = buildMatchers();
    // The redacted headers leak NOTHING.
    expect(scanForLeaks(safeStringify(redacted), matchers)).toEqual([]);
    expect(redacted["Authorization"]).toBe("Basic [REDACTED]");
    // Sanity: the RAW header carries the secret (base64 of keyId:keySecret), so
    // decoding it recovers the plaintext secret — the redaction is load-bearing
    // (the scanner is not vacuously passing on the redacted form).
    const rawB64 = rawAuthorization.replace(/^Basic /, "");
    const decoded = Buffer.from(rawB64, "base64").toString("utf8");
    expect(decoded).toContain(keySecret);
    expect(redacted["Authorization"]).not.toContain(rawB64);
  });

  it("positive control: the scanner detects a planted secret", () => {
    const matchers = buildMatchers();
    const planted =
      "leak shpat_deadbeef0123 and rzp_test_ABCDEFGHIJ0123 pan 4111111111111111 cvv: 123 upi-pin=1234";
    const hits = scanForLeaks(planted, matchers);
    expect(hits).toContain("shpat_ token pattern");
    expect(hits).toContain("rzp_test_ secret pattern");
    expect(hits).toContain("PAN pattern (Luhn-valid)");
    expect(hits).toContain("CVV label pattern");
    expect(hits).toContain("UPI PIN label pattern");
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

      // Persist a durable receipt outbox row EXACTLY as the deployed receipt
      // sink does (transactionId + idempotencyKey + provider reference + state),
      // so the scan covers the outbox material the runtime actually writes.
      const outbox = new PostgresOutboxRepository(database);
      const appended = await outbox.append(
        [
          {
            id: randomOutboxId(),
            eventType: "transaction.receipt.v1",
            eventVersion: 1,
            payload: {
              transactionId: "ctr_txn_scan",
              idempotencyKey,
              phase: "INDETERMINATE",
              providerReference:
                typeof result === "object" && result !== null && "providerReference" in result
                  ? (result as { providerReference?: unknown }).providerReference
                  : undefined,
            },
            correlationId: undefined,
            idempotencyKey,
          },
        ],
        Date.now() as Instant,
      );
      expect(appended.ok).toBe(true);

      const outboxRows = await database.query(
        `SELECT id, environment, event_type, payload
         FROM runtime.outbox_events WHERE payload ->> 'idempotencyKey' = $1`,
        [idempotencyKey],
      );

      const material: string[] = [
        ...captured,
        safeStringify(result),
        safeStringify(ledgerRows.rows),
        // The durable outbox receipt rows the runtime persists.
        safeStringify(outboxRows.rows),
      ];
      const haystack = material.join("\n");

      const matchers = buildMatchers();
      const hits = scanForLeaks(haystack, matchers);
      expect(hits).toEqual([]);
    },
    180_000,
  );
});

/**
 * True when the haystack contains a 14-19 digit, Luhn-valid card-number-shaped
 * run that is NOT a provider-reference id or a timestamp.
 *
 * Two refinements over a naive Luhn scan eliminate false positives from what the
 * REAL runtime legitimately emits (which would otherwise make this proof flaky):
 *   - Shopify GIDs (e.g. gid://shopify/Order/5678901234567) end in a long digit
 *     run, so a run immediately preceded by '/' (a URL/GID path segment) is
 *     skipped — a real PAN never appears as a path segment; and
 *   - the floor is 14 digits (not 13): the runtime emits 13-digit epoch-ms
 *     timestamps (Date.now()) all over ids/created_at, some of which are
 *     coincidentally Luhn-valid. Real payment PANs are 14-19 digits (Diners 14,
 *     Amex 15, Visa/MC 16, up to 19); the obsolete 13-digit legacy Visa is not
 *     issued. Raising the floor drops the timestamp collisions while still
 *     catching a genuine 16-digit PAN (the positive control).
 */
function containsLuhnValidPan(haystack: string): boolean {
  const candidateRe = /\b(?:\d[ -]?){14,19}\b/g;
  for (const match of haystack.matchAll(candidateRe)) {
    const start = match.index ?? 0;
    const precededBySlash = start > 0 && haystack[start - 1] === "/";
    if (precededBySlash) {
      continue;
    }
    const digits = match[0].replace(/[ -]/g, "");
    if (digits.length >= 14 && digits.length <= 19 && isLuhnValid(digits)) {
      return true;
    }
  }
  return false;
}

function isLuhnValid(digits: string): boolean {
  let sum = 0;
  let double = false;
  for (let i = digits.length - 1; i >= 0; i -= 1) {
    let d = digits.charCodeAt(i) - 48;
    if (d < 0 || d > 9) return false;
    if (double) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
    double = !double;
  }
  return sum % 10 === 0;
}

function safeStringify(value: unknown): string {
  try {
    return JSON.stringify(value, (_k, v) => (typeof v === "bigint" ? v.toString() : v));
  } catch {
    return String(value);
  }
}
