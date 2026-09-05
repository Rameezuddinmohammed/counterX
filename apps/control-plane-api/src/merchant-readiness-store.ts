/**
 * Self-serve merchant onboarding, Step 5: readiness check.
 *
 * Assembles REAL evidence for the first five ReadinessCheckKinds
 * (packages/merchant-application/src/readiness-types.ts) from this
 * deployment's own durable state and runs it through the real
 * ReadinessEngine.evaluateAll() (packages/merchant-application/src/
 * readiness-engine.ts) — worst-of-severity, exactly as that engine already
 * defines it. `evidence_valid` is deliberately NOT evaluated: it belongs to
 * a later, not-yet-built evidence-bundle concept (packages/merchant-
 * application/src/evidence-bundle.ts), out of scope for this pass.
 *
 * JUDGMENT CALLS, disclosed here rather than left ambiguous:
 *
 *  - connector_health: a Shopify-connected merchant's evidence uses the
 *    connection's own connected_at as a "last known good" timestamp (there
 *    is no real periodic heartbeat mechanism anywhere in this codebase yet
 *    for either Shopify or the manual-catalog path). A manual-catalog-only
 *    merchant gets an equivalent synthetic "healthy" evidence keyed off
 *    catalog_confirmed_at. A merchant with NEITHER a Shopify connection nor
 *    any manual item is Blocking — represented by handing the engine an
 *    already-expired check, since ReadinessEvidence has no direct "never
 *    configured" variant (see `#neverConfiguredEvidence` below).
 *
 *  - mapping_freshness: sourced from Step 3's catalog_confirmed_at
 *    (merchant.onboarding_applications). Not yet confirmed -> Blocking, via
 *    the same already-expired-check technique.
 *
 *  - policy_compiled: reuses the SAME PolicyStore/PolicyCompiler instances
 *    createServer() already wires into policy-routes.ts (passed in here by
 *    reference, not a second compiler). If the merchant has no policy
 *    configured yet, this compiles and PERSISTS a sensible default — a
 *    real @counter/merchant-policy MerchantPolicyRuleSet, not an invented
 *    shape — into that SAME store, so it becomes visible through the
 *    existing GET /control/v1/merchants/:merchantId/policy route too, not a
 *    shadow copy. The default rule set is `inr-only` + `india-destination:
 *    ["IN"]` — the least-restrictive REAL rule combination expressible in
 *    the typed 12-rule union that still says something true (this pilot is
 *    INR/India-only everywhere else too, e.g. quote-builder.ts's hardcoded
 *    country: "IN") — with no product/category/quantity/payment-path
 *    restriction. This is a real, disclosed judgment call: a hand-authored
 *    policy is likely more correct than this synthesized default, but
 *    refusing readiness entirely for every self-serve merchant until they
 *    hand-author one would make Step 5 permanently unreachable for the
 *    wizard this task is building. Narrowing the default is real follow-up
 *    work. (Earlier revision of this file tied the default to the
 *    merchant's declared goods types via an invented
 *    {category:"fulfillment", constraint:"allow"} shape that had no
 *    counterpart in the real typed rule union — dropped along with that
 *    fake shape; goods-type-scoped policy is real follow-up work, not
 *    something this pass silently drops in favor of.)
 *
 *  - payment_configured: sourced from merchant.payment_connections (Step
 *    4's own-gateway Razorpay verification). Not configured -> Blocking.
 *
 *  - protocol_version: static, always healthy — CTP_VERSION from
 *    @counter/trust-protocol, the same constant every CTP envelope in this
 *    codebase is built and verified against.
 *
 * Auto-transition choice, disclosed: this same evaluate() call performs
 * VERIFYING -> SANDBOX_READY automatically the moment isReady is true,
 * rather than requiring a second explicit "activate" call. Reasoning: the
 * wizard's UI (apps/merchant-console/src/app/invite/readiness/page.tsx) is
 * a single "Check readiness" button; splitting "check" from "advance" into
 * two round-trips would just be an extra click with no real safety benefit
 * at this SANDBOX_READY (not yet ACTIVATION_REVIEW/live) stage — the next
 * real gate (ACTIVATION_REVIEW -> ACTIVE) still requires a human/operator
 * step this task does not touch. Idempotent: repeat calls once already
 * SANDBOX_READY (or later) just re-evaluate and report current status
 * without re-transitioning.
 */
import type { Environment, MerchantId, MerchantUserId } from "@counter/domain";
import {
  instantFromEpochMilliseconds,
  MAX_INSTANT_EPOCH_MILLISECONDS,
  sha256Digest,
  parseCounterId,
  SystemClock,
  type Instant,
} from "@counter/domain";
import type { TransactionalDatabase } from "@counter/data";
import {
  ReadinessEngine,
  transitionMerchantLifecycle,
  isMerchantLifecycleState,
  type ReadinessCheck,
  type ReadinessCheckKind,
  type ReadinessStatus,
  type VersionBindings,
  type MerchantLifecycleState,
} from "@counter/merchant-application";
import { CTP_VERSION } from "@counter/trust-protocol";
import type { MerchantPolicyRuleSet } from "@counter/merchant-policy";
import type { PolicyStore, PolicyCompiler } from "./policy-routes.js";

export interface ReadinessCheckView {
  readonly checkKind: ReadinessCheckKind;
  readonly status: ReadinessStatus;
  readonly reason: string;
}

export interface MerchantReadinessSummary {
  readonly merchantId: string;
  readonly isReady: boolean;
  readonly overallStatus: ReadinessStatus;
  readonly checks: readonly ReadinessCheckView[];
  readonly lifecycleState: MerchantLifecycleState;
  readonly versionBindings: VersionBindings;
  readonly evaluatedAt: string;
}

/** A client-caused failure (unknown merchant) — maps to 404 at the route layer. */
export class MerchantReadinessError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MerchantReadinessError";
  }
}

export interface MerchantReadinessServiceLike {
  evaluate(merchantId: string): Promise<MerchantReadinessSummary>;
}

const CONNECTOR_VERSION_SHOPIFY = "shopify-oauth@1";
const CONNECTOR_VERSION_MANUAL = "manual-catalog@1";
const PAYMENT_PROVIDER_VERSION_RAZORPAY_BYO = "razorpay-byo@1";

function toInstant(dateLike: string | Date | number): Instant {
  const ms = dateLike instanceof Date ? dateLike.getTime() : new Date(dateLike).getTime();
  const result = instantFromEpochMilliseconds(ms);
  if (!result.ok) {
    throw new Error("Failed to derive an Instant from a stored timestamp");
  }
  return result.value;
}

function nowInstant(): Instant {
  const result = instantFromEpochMilliseconds(Date.now());
  if (!result.ok) {
    throw new Error("Failed to derive the current instant");
  }
  return result.value;
}

/**
 * Represents "this dimension was never configured" as an already-expired
 * check — ReadinessEvidence has no direct variant for that state, but the
 * engine's own semantics (readiness-engine.ts's #evaluateCheck) already
 * score an expired check as Blocking, which is the correct outcome here.
 */
function neverConfiguredExpiry(): Instant {
  const result = instantFromEpochMilliseconds(0);
  if (!result.ok) {
    throw new Error("Failed to derive the epoch instant");
  }
  return result.value;
}

export class MerchantReadinessService implements MerchantReadinessServiceLike {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
    private readonly policyStore: PolicyStore,
    private readonly policyCompiler: PolicyCompiler,
    private readonly engine: ReadinessEngine = new ReadinessEngine(new SystemClock()),
  ) {}

  async evaluate(merchantId: string): Promise<MerchantReadinessSummary> {
    const parsedMerchantId = parseCounterId(merchantId, "merchant");
    if (!parsedMerchantId.ok) {
      throw new MerchantReadinessError(`Invalid merchantId: ${parsedMerchantId.error.message}`);
    }
    const typedMerchantId = parsedMerchantId.value as MerchantId;

    const appRow = await this.database.query<{
      lifecycle_state: string;
      lifecycle_version: number;
      merchant_user_actor_id: string;
      goods_types: readonly string[] | null;
      catalog_confirmed_at: string | Date | null;
    }>(
      `SELECT lifecycle_state, lifecycle_version, merchant_user_actor_id, goods_types, catalog_confirmed_at
         FROM merchant.onboarding_applications
        WHERE environment = $1 AND merchant_id = $2`,
      [this.environment, merchantId],
    );
    const application = appRow.rows[0];
    if (application === undefined) {
      throw new MerchantReadinessError(`No such merchant application: ${merchantId}`);
    }
    if (!isMerchantLifecycleState(application.lifecycle_state)) {
      throw new Error("Corrupt onboarding application row: invalid lifecycle_state");
    }
    const shopifyRow = await this.database.query<{ connected_at: string | Date }>(
      `SELECT connected_at FROM merchant.shopify_connections
        WHERE environment = $1 AND merchant_id = $2 AND status = 'active'`,
      [this.environment, merchantId],
    );
    const shopify = shopifyRow.rows[0];

    const manualItemsRow = await this.database.query<{ count: string }>(
      `SELECT count(*)::text AS count FROM merchant.manual_catalog_items
        WHERE environment = $1 AND merchant_id = $2`,
      [this.environment, merchantId],
    );
    const manualItemCount = Number(manualItemsRow.rows[0]?.count ?? "0");

    const paymentRow = await this.database.query<{ verified_at: string | Date }>(
      `SELECT verified_at FROM merchant.payment_connections
        WHERE environment = $1 AND merchant_id = $2`,
      [this.environment, merchantId],
    );
    const paymentConnection = paymentRow.rows[0];

    // ── connector_health ──────────────────────────────────────────────
    let connectorHealthCheck: ReadinessCheck;
    let connectorVersion: string;
    if (shopify !== undefined) {
      connectorVersion = CONNECTOR_VERSION_SHOPIFY;
      connectorHealthCheck = {
        merchantId: typedMerchantId,
        checkKind: "connector_health",
        evidence: {
          kind: "connector_health",
          connectorId: "shopify",
          connectorVersion,
          lastHeartbeatAt: toInstant(shopify.connected_at),
        },
        expiresAt: null,
        acceptedLimitation: null,
      };
    } else if (manualItemCount > 0) {
      connectorVersion = CONNECTOR_VERSION_MANUAL;
      connectorHealthCheck = {
        merchantId: typedMerchantId,
        checkKind: "connector_health",
        evidence: {
          kind: "connector_health",
          connectorId: "manual-catalog",
          connectorVersion,
          lastHeartbeatAt:
            application.catalog_confirmed_at !== null
              ? toInstant(application.catalog_confirmed_at)
              : nowInstant(),
        },
        expiresAt: null,
        acceptedLimitation: null,
      };
    } else {
      connectorVersion = "none";
      connectorHealthCheck = {
        merchantId: typedMerchantId,
        checkKind: "connector_health",
        evidence: {
          kind: "connector_health",
          connectorId: "none",
          connectorVersion,
          lastHeartbeatAt: neverConfiguredExpiry(),
        },
        expiresAt: neverConfiguredExpiry(),
        acceptedLimitation: null,
      };
    }

    // ── mapping_freshness ──────────────────────────────────────────────
    let mappingFreshnessCheck: ReadinessCheck;
    let mappingSchemaHash: ReturnType<typeof sha256Digest>;
    if (application.catalog_confirmed_at !== null) {
      mappingSchemaHash = sha256Digest(
        new TextEncoder().encode(
          JSON.stringify({ merchantId, catalogConfirmedAt: application.catalog_confirmed_at }),
        ),
      );
      mappingFreshnessCheck = {
        merchantId: typedMerchantId,
        checkKind: "mapping_freshness",
        evidence: {
          kind: "mapping_freshness",
          mappingSchemaHash,
          updatedAt: toInstant(application.catalog_confirmed_at),
        },
        expiresAt: null,
        acceptedLimitation: null,
      };
    } else {
      mappingSchemaHash = sha256Digest(new TextEncoder().encode("unconfirmed"));
      mappingFreshnessCheck = {
        merchantId: typedMerchantId,
        checkKind: "mapping_freshness",
        evidence: {
          kind: "mapping_freshness",
          mappingSchemaHash,
          updatedAt: neverConfiguredExpiry(),
        },
        expiresAt: neverConfiguredExpiry(),
        acceptedLimitation: null,
      };
    }

    // ── policy_compiled ──────────────────────────────────────────────
    const { check: policyCheck, policyVersion } = await this.#evaluatePolicy(
      typedMerchantId,
      merchantId,
    );

    // ── payment_configured ──────────────────────────────────────────────
    let paymentCheck: ReadinessCheck;
    if (paymentConnection !== undefined) {
      paymentCheck = {
        merchantId: typedMerchantId,
        checkKind: "payment_configured",
        evidence: {
          kind: "payment_configured",
          paymentProviderVersion: PAYMENT_PROVIDER_VERSION_RAZORPAY_BYO,
          configuredAt: toInstant(paymentConnection.verified_at),
        },
        expiresAt: null,
        acceptedLimitation: null,
      };
    } else {
      // DELIBERATE PRODUCT DECISION (buildathon demo, revisit before any real
      // pilot cohort): payment_configured no longer BLOCKS activation when no
      // Razorpay connection exists. Rationale, confirmed directly with the
      // founder — every merchant in this deployment shares ONE platform-level
      // Razorpay account (see wallet-topup-routes.ts / boot.ts's own
      // documented single-pilot-merchant credential), and no purchase path
      // today settles a real payment into a merchant's own connected account
      // anyway: the prepaid-balance branch in apps/worker/src/real-lifecycle.ts
      // debits an internal ledger with no Razorpay call at all. Requiring a
      // per-merchant Razorpay connection before going live was therefore
      // gating on a promise ("you will receive money through this") the
      // system does not keep yet — see the Pending Settlement card
      // (apps/merchant-console/src/app/page.tsx) for the honest statement of
      // what actually happens to collected funds instead.
      //
      // AcceptedLimitation, not Advisory: this is a KNOWN, NAMED gap being
      // knowingly proceeded past, not a healthy check. It still shows up in
      // readiness output and keeps a real reason string, so a later session
      // re-tightening this for a genuine multi-merchant-with-real-settlement
      // pilot finds a labeled decision here, not a silently vanished check.
      paymentCheck = {
        merchantId: typedMerchantId,
        checkKind: "payment_configured",
        evidence: {
          kind: "payment_configured",
          paymentProviderVersion: "none",
          configuredAt: neverConfiguredExpiry(),
        },
        expiresAt: null,
        acceptedLimitation:
          "No per-merchant settlement account required for this deployment — Counter " +
          "collects buyer payments centrally and settlement is pending (see Pending Settlement)",
      };
    }

    // ── protocol_version ──────────────────────────────────────────────
    const protocolCheck: ReadinessCheck = {
      merchantId: typedMerchantId,
      checkKind: "protocol_version",
      evidence: {
        kind: "protocol_version",
        protocolVersion: CTP_VERSION,
        supportedSince: neverConfiguredExpiry(),
      },
      expiresAt: null,
      acceptedLimitation: null,
    };

    const result = this.engine.evaluateAll(typedMerchantId, [
      connectorHealthCheck,
      mappingFreshnessCheck,
      policyCheck,
      paymentCheck,
      protocolCheck,
    ]);

    const versionBindings: VersionBindings = {
      connectorVersion,
      mappingSchemaHash,
      policyVersion,
      protocolVersion: CTP_VERSION,
      paymentProviderVersion:
        paymentConnection !== undefined ? PAYMENT_PROVIDER_VERSION_RAZORPAY_BYO : "none",
    };

    let lifecycleState: MerchantLifecycleState = application.lifecycle_state;
    if (result.isReady && application.lifecycle_state === "VERIFYING") {
      const parsedActorId = parseCounterId(application.merchant_user_actor_id, "merchant-user");
      if (!parsedActorId.ok) {
        throw new Error("Corrupt onboarding application row: invalid merchant_user_actor_id");
      }
      const transition = transitionMerchantLifecycle({
        merchantId: typedMerchantId,
        currentState: application.lifecycle_state,
        targetState: "SANDBOX_READY",
        actor: { kind: "merchant_user", id: parsedActorId.value as MerchantUserId },
        reason: "readiness check passed with no blocking checks",
        occurredAt: nowInstant(),
        currentVersion: application.lifecycle_version,
      });
      if (transition.ok) {
        const now = new Date().toISOString();
        await this.database.query(
          `UPDATE merchant.onboarding_applications
              SET lifecycle_state = $3, lifecycle_version = $4, updated_at = $5
            WHERE environment = $1 AND merchant_id = $2`,
          [this.environment, merchantId, transition.value.toState, transition.value.version, now],
        );
        lifecycleState = transition.value.toState;
      }
      // If the transition itself is rejected (e.g. a concurrent transition
      // already moved state), fall through and report the pre-transition
      // status honestly rather than throwing — the merchant still sees an
      // accurate readiness picture.
    }

    return {
      merchantId,
      isReady: result.isReady,
      overallStatus: result.overallStatus,
      checks: result.checkResults.map((checkResult) => ({
        checkKind: checkResult.checkKind,
        status: checkResult.status,
        reason: checkResult.reason,
      })),
      lifecycleState,
      versionBindings,
      evaluatedAt: new Date().toISOString(),
    };
  }

  async #evaluatePolicy(
    typedMerchantId: MerchantId,
    merchantId: string,
  ): Promise<{ check: ReadinessCheck; policyVersion: string }> {
    let entry = await this.policyStore.get(merchantId);

    if (entry === undefined) {
      // No policy configured yet: compile+persist a real, permissive
      // default — see this file's header for the full disclosure of this
      // judgment call and why inr-only + india-destination:["IN"] is the
      // chosen "no meaningful restriction yet" baseline.
      const nowResult = instantFromEpochMilliseconds(Date.now());
      const maxInstantResult = instantFromEpochMilliseconds(MAX_INSTANT_EPOCH_MILLISECONDS);
      if (!nowResult.ok || !maxInstantResult.ok) {
        throw new Error("Failed to derive instants for the default policy rule set");
      }
      const defaultRuleSet: MerchantPolicyRuleSet = {
        version: 1,
        merchantId,
        rules: [{ kind: "inr-only" }, { kind: "india-destination", allowedDestinations: ["IN"] }],
        effectiveFrom: nowResult.value,
        effectiveUntil: maxInstantResult.value,
      };
      const validation = this.policyCompiler.validate(defaultRuleSet);
      if (validation.valid) {
        const setResult = await this.policyStore.set(merchantId, defaultRuleSet, undefined);
        entry = { config: defaultRuleSet, version: setResult.currentVersion };
      }
    }

    if (entry === undefined) {
      // Could not even synthesize a valid default — honestly Blocking
      // rather than silently passing.
      return {
        policyVersion: "none",
        check: {
          merchantId: typedMerchantId,
          checkKind: "policy_compiled",
          evidence: {
            kind: "policy_compiled",
            policyVersion: "none",
            compiledAt: neverConfiguredExpiry(),
            policyDigest: sha256Digest(new TextEncoder().encode("none")),
          },
          expiresAt: neverConfiguredExpiry(),
          acceptedLimitation: null,
        },
      };
    }

    const policyVersionLabel = String(entry.config.version);
    const validation = this.policyCompiler.validate(entry.config);
    if (!validation.valid) {
      return {
        policyVersion: policyVersionLabel,
        check: {
          merchantId: typedMerchantId,
          checkKind: "policy_compiled",
          evidence: {
            kind: "policy_compiled",
            policyVersion: policyVersionLabel,
            compiledAt: neverConfiguredExpiry(),
            policyDigest: sha256Digest(new TextEncoder().encode(policyVersionLabel)),
          },
          expiresAt: neverConfiguredExpiry(),
          acceptedLimitation: null,
        },
      };
    }

    const compiled = this.policyCompiler.compile(entry.config, nowInstant());
    if (!compiled.ok) {
      // Structurally valid but ambiguous (e.g. two rules on the same
      // dimension) — honestly Blocking, same treatment as a failed
      // validate() above.
      return {
        policyVersion: policyVersionLabel,
        check: {
          merchantId: typedMerchantId,
          checkKind: "policy_compiled",
          evidence: {
            kind: "policy_compiled",
            policyVersion: policyVersionLabel,
            compiledAt: neverConfiguredExpiry(),
            policyDigest: sha256Digest(new TextEncoder().encode(policyVersionLabel)),
          },
          expiresAt: neverConfiguredExpiry(),
          acceptedLimitation: null,
        },
      };
    }
    // A compiled policy's constraints always carry bigint Money fields
    // (maxAmount/minAmount are always populated — see compiler.ts's
    // defaults) and the rule set itself may too (review-threshold) —
    // JSON.stringify throws on a raw bigint, so this needs the same
    // bigint-safe replacer pattern used elsewhere in this codebase (e.g.
    // packages/data/src/quote-store.ts's bigintSafeReplacer).
    const policyDigest = sha256Digest(
      new TextEncoder().encode(
        JSON.stringify(
          { config: entry.config, compiled: compiled.value },
          (_key, value: unknown) => (typeof value === "bigint" ? value.toString() : value),
        ),
      ),
    );
    return {
      policyVersion: policyVersionLabel,
      check: {
        merchantId: typedMerchantId,
        checkKind: "policy_compiled",
        evidence: {
          kind: "policy_compiled",
          policyVersion: policyVersionLabel,
          compiledAt: compiled.value.compiledAt,
          policyDigest,
        },
        expiresAt: null,
        acceptedLimitation: null,
      },
    };
  }
}
