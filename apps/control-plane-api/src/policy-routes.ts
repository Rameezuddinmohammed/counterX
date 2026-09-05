/**
 * Policy management routes for the control plane API.
 *
 * Provides POST/GET /control/v1/merchants/:merchantId/policy endpoints for
 * configuring and querying a merchant's REAL, typed policy rule set.
 *
 * TYPE RECONCILIATION (disclosed judgment call): this route used to define
 * its own loose, semantically-empty API-layer shape
 * ({ruleId, category, constraint, parameters, enabled}), disconnected from
 * @counter/merchant-policy's real 12-rule discriminated union
 * (MerchantPolicyRuleConfig / MerchantPolicyRuleSet) and backed by a
 * createDefaultPolicyCompiler() that only counted enabled rules — it never
 * actually compiled or validated anything about products, categories,
 * prices, or refunds. This route now uses the real typed union directly as
 * its wire contract (translated to/from JSON via policy-wire.ts, since JSON
 * cannot carry a bigint Money.amountMinor or a branded Instant), and its
 * compiler is real: compileMerchantPolicy()/validateRuleSet() from
 * @counter/merchant-policy, not a hand-rolled stand-in.
 *
 * Verified before choosing this over a translation-layer approach: the only
 * callers of this route/these types were (1) merchant-readiness-store.ts's
 * internal default-policy synthesis (updated alongside this file) and (2)
 * apps/merchant-console's demo /policy page and its dashboard card (both
 * updated alongside this file) — no external caller depends on the old
 * loose wire shape, so there was nothing to preserve a translation layer
 * for.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import { getCorrelationId, getActorContext, registerRoutePermission } from "@counter/http-api-kit";
import type { Instant } from "@counter/domain";
import {
  compileMerchantPolicy,
  parseRuleSetBody,
  renderPolicySummary,
  serializeRuleSet,
  validateRuleSet,
  type CompiledMerchantPolicy,
  type MerchantPolicyRuleSet,
} from "@counter/merchant-policy";

export type { MerchantPolicyRuleSet } from "@counter/merchant-policy";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PolicyStoreEntry {
  readonly config: MerchantPolicyRuleSet;
  readonly version: number;
}

export interface PolicyStore {
  get(merchantId: string): Promise<PolicyStoreEntry | undefined>;
  /**
   * Conditionally stores a policy config. If expectedVersion is provided,
   * the write succeeds only if the current version matches. Returns the
   * outcome with the current version number.
   */
  set(
    merchantId: string,
    config: MerchantPolicyRuleSet,
    expectedVersion: number | undefined,
  ): Promise<{ readonly success: boolean; readonly currentVersion: number }>;
}

export interface PolicyValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

export interface PolicyCompiler {
  compile(ruleSet: MerchantPolicyRuleSet, now: Instant): ReturnType<typeof compileMerchantPolicy>;
  validate(ruleSet: MerchantPolicyRuleSet): PolicyValidationResult;
}

export interface PolicyRoutesOptions {
  readonly store: PolicyStore;
  readonly compiler: PolicyCompiler;
}

// ---------------------------------------------------------------------------
// In-Memory Store (for testing / development)
// ---------------------------------------------------------------------------

export function createInMemoryPolicyStore(): PolicyStore {
  const policies = new Map<string, PolicyStoreEntry>();
  return {
    async get(merchantId: string) {
      return policies.get(merchantId);
    },
    async set(
      merchantId: string,
      config: MerchantPolicyRuleSet,
      expectedVersion: number | undefined,
    ): Promise<{ readonly success: boolean; readonly currentVersion: number }> {
      const existing = policies.get(merchantId);
      const currentVersion = existing?.version ?? 0;

      // If expectedVersion is provided, enforce optimistic concurrency
      if (expectedVersion !== undefined && expectedVersion !== currentVersion) {
        return { success: false, currentVersion };
      }

      const newVersion = currentVersion + 1;
      policies.set(merchantId, { config, version: newVersion });
      return { success: true, currentVersion: newVersion };
    },
  };
}

/**
 * Real compiler: compile() calls @counter/merchant-policy's
 * compileMerchantPolicy() (structural validation + ambiguity detection +
 * MerchantPolicyConstraints construction); validate() calls its
 * validateRuleSet(). Neither reinvents rule semantics — both delegate
 * entirely to the already-tested package.
 */
export function createDefaultPolicyCompiler(): PolicyCompiler {
  return {
    compile(ruleSet: MerchantPolicyRuleSet, now: Instant) {
      return compileMerchantPolicy(ruleSet, now);
    },
    validate(ruleSet: MerchantPolicyRuleSet): PolicyValidationResult {
      const errors = validateRuleSet(ruleSet);
      return { valid: errors.length === 0, errors };
    },
  };
}

// ---------------------------------------------------------------------------
// Tenant isolation: verify the authenticated principal owns the merchantId
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

function summarize(compiled: CompiledMerchantPolicy): {
  readonly version: number;
  readonly compiledAt: string;
  readonly summary: readonly string[];
} {
  return {
    version: compiled.version,
    compiledAt: new Date(compiled.compiledAt).toISOString(),
    summary: renderPolicySummary(compiled),
  };
}

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export async function policyRoutesPlugin(
  fastify: FastifyInstance,
  options: PolicyRoutesOptions,
): Promise<void> {
  const { store, compiler } = options;

  const ROUTE_PREFIX = "/control/v1/merchants/:merchantId/policy";

  // POST creates/updates policy configuration: this is a mutation and MUST
  // require the WRITE permission (identity.scope.manage), not a read permission.
  registerRoutePermission(`POST:${ROUTE_PREFIX}`, {
    permission: "identity.scope.manage",
  });
  registerRoutePermission(`GET:${ROUTE_PREFIX}`, {
    permission: "identity.scope.read",
  });

  // POST - Create/update policy
  fastify.post(ROUTE_PREFIX, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as Record<string, string>;
    const merchantId = params["merchantId"] ?? "";

    if (!verifyTenantAccess(request, merchantId)) {
      void reply.status(403).send({
        error: {
          code: "FORBIDDEN",
          message: "Access denied for the requested merchant",
        },
      });
      return;
    }

    const correlationId = getCorrelationId(request);

    const parsedBody = parseRuleSetBody(request.body);
    if (Array.isArray(parsedBody)) {
      void reply.status(400).send({
        error: {
          code: "INVALID_FORMAT",
          message: parsedBody[0] ?? "Invalid policy body",
          details: { errors: parsedBody },
        },
      });
      return;
    }

    // Parse If-Match header for version-conflict detection
    const ifMatchHeader = request.headers["if-match"];
    let expectedVersion: number | undefined;
    if (typeof ifMatchHeader === "string" && ifMatchHeader !== "") {
      const parsed = Number(ifMatchHeader);
      if (Number.isNaN(parsed) || !Number.isInteger(parsed) || parsed < 0) {
        void reply.status(400).send({
          error: {
            code: "INVALID_FORMAT",
            message: "If-Match header must be a non-negative integer version",
          },
        });
        return;
      }
      expectedVersion = parsed;
    }

    // The rule set's own declared `version` (embedded in the compiled
    // policy's `source` label, and in validateRuleSet's version>0 check) is
    // assigned here from the store's current version — a merchant/UI never
    // supplies it directly, since the store's optimistic-concurrency counter
    // is already the one authoritative version number for this resource.
    // This read-then-write has a narrow, disclosed race: if another writer's
    // store.set() lands between this get() and this request's own store.set()
    // below, the *label* embedded in this request's compiled preview could be
    // stale — but the actual conflict check (expectedVersion vs. the store's
    // real current version) still happens atomically inside store.set(),
    // so a race here can produce at worst a cosmetically-off version label,
    // never a lost update or a bypassed If-Match check. Acceptable for a
    // single-editor-per-merchant pilot; revisit if concurrent policy editors
    // become real.
    const existing = await store.get(merchantId);
    const candidateVersion = (existing?.version ?? 0) + 1;

    const ruleSet: MerchantPolicyRuleSet = {
      version: candidateVersion,
      merchantId,
      rules: parsedBody.rules,
      effectiveFrom: parsedBody.effectiveFrom,
      effectiveUntil: parsedBody.effectiveUntil,
    };

    // Validate first
    const validationResult = compiler.validate(ruleSet);
    if (!validationResult.valid) {
      void reply.status(400).send({
        error: {
          code: "INVALID_FORMAT",
          message: "Policy validation failed",
          details: { errors: validationResult.errors },
        },
      });
      return;
    }

    // Compile (also catches cross-rule ambiguity — multiple rules on the
    // same dimension — which validate() alone does not check).
    const now = Date.now() as Instant;
    const compiled = compiler.compile(ruleSet, now);
    if (!compiled.ok) {
      void reply.status(400).send({
        error: {
          code: compiled.error.code,
          message: compiled.error.message,
        },
      });
      return;
    }

    // Store with optimistic concurrency
    const storeResult = await store.set(merchantId, ruleSet, expectedVersion);
    if (!storeResult.success) {
      void reply.status(409).send({
        error: {
          code: "VERSION_CONFLICT",
          message: "Policy was modified by another writer",
          details: {
            currentVersion: storeResult.currentVersion,
            expectedVersion,
          },
        },
      });
      return;
    }

    void reply
      .status(201)
      .header("etag", String(storeResult.currentVersion))
      .send({
        merchantId,
        policyVersion: String(ruleSet.version),
        compiled: summarize(compiled.value),
        correlationId,
      });
  });

  // GET - Retrieve current policy
  fastify.get(ROUTE_PREFIX, async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as Record<string, string>;
    const merchantId = params["merchantId"] ?? "";

    if (!verifyTenantAccess(request, merchantId)) {
      void reply.status(403).send({
        error: {
          code: "FORBIDDEN",
          message: "Access denied for the requested merchant",
        },
      });
      return;
    }

    const correlationId = getCorrelationId(request);

    const entry = await store.get(merchantId);
    if (entry === undefined) {
      void reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "No policy configured for this merchant",
        },
      });
      return;
    }

    const now = Date.now() as Instant;
    const compiled = compiler.compile(entry.config, now);

    void reply.header("etag", String(entry.version)).send({
      merchantId,
      policy: serializeRuleSet(entry.config),
      // Plain-language summary of what's actually enforced — a
      // non-technical merchant reads this, not the raw typed rules.
      summary: compiled.ok ? renderPolicySummary(compiled.value) : [],
      correlationId,
    });
  });
}
