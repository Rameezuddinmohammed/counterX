/**
 * Policy management routes for the control plane API.
 *
 * Provides POST/GET /control/v1/merchants/:merchantId/policy endpoints
 * for configuring and querying merchant-specific policy rules.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  getCorrelationId,
  getActorContext,
  registerRoutePermission,
} from "@counter/http-api-kit";

// ---------------------------------------------------------------------------
// Control-plane policy types (API-layer representations)
// ---------------------------------------------------------------------------

export interface MerchantPolicyRule {
  readonly ruleId: string;
  readonly category: string;
  readonly constraint: string;
  readonly parameters: Record<string, unknown>;
  readonly enabled: boolean;
}

export interface MerchantPolicyConfig {
  readonly merchantId: string;
  readonly policyVersion: string;
  readonly rules: readonly MerchantPolicyRule[];
  readonly effectiveFrom: string;
  readonly effectiveUntil: string | null;
}

export interface CompiledPolicyResult {
  readonly success: boolean;
  readonly constraintCount: number;
  readonly compiledAt: string;
}

export interface PolicyValidationResult {
  readonly valid: boolean;
  readonly errors: readonly string[];
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

export interface PolicyStoreEntry {
  readonly config: MerchantPolicyConfig;
  readonly version: number;
}

export interface PolicyStore {
  get(merchantId: string): PolicyStoreEntry | undefined;
  /**
   * Conditionally stores a policy config. If expectedVersion is provided,
   * the write succeeds only if the current version matches. Returns the
   * outcome with the current version number.
   */
  set(merchantId: string, config: MerchantPolicyConfig, expectedVersion: number | undefined): { readonly success: boolean; readonly currentVersion: number };
}

export interface PolicyCompiler {
  compile(config: MerchantPolicyConfig): CompiledPolicyResult;
  validate(config: MerchantPolicyConfig): PolicyValidationResult;
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
    get(merchantId: string) {
      return policies.get(merchantId);
    },
    set(merchantId: string, config: MerchantPolicyConfig, expectedVersion: number | undefined): { readonly success: boolean; readonly currentVersion: number } {
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

export function createDefaultPolicyCompiler(): PolicyCompiler {
  return {
    compile(config: MerchantPolicyConfig): CompiledPolicyResult {
      const enabledRules = config.rules.filter((r) => r.enabled);
      return {
        success: true,
        constraintCount: enabledRules.length,
        compiledAt: new Date().toISOString(),
      };
    },
    validate(config: MerchantPolicyConfig): PolicyValidationResult {
      const errors: string[] = [];
      if (config.rules.length === 0) {
        errors.push("At least one policy rule is required");
      }
      for (const rule of config.rules) {
        if (rule.ruleId === "") {
          errors.push("Rule ID must not be empty");
        }
        if (rule.category === "") {
          errors.push("Rule category must not be empty");
        }
      }
      return {
        valid: errors.length === 0,
        errors,
      };
    },
  };
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

function validatePolicyBody(body: unknown): string | undefined {
  if (body === null || body === undefined || typeof body !== "object") {
    return "Request body is required";
  }
  const obj = body as Record<string, unknown>;
  if (typeof obj["policyVersion"] !== "string" || obj["policyVersion"] === "") {
    return "Field 'policyVersion' is required";
  }
  if (!Array.isArray(obj["rules"])) {
    return "Field 'rules' must be an array";
  }
  if (typeof obj["effectiveFrom"] !== "string" || obj["effectiveFrom"] === "") {
    return "Field 'effectiveFrom' is required";
  }
  return undefined;
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

// ---------------------------------------------------------------------------
// Plugin
// ---------------------------------------------------------------------------

export async function policyRoutesPlugin(
  fastify: FastifyInstance,
  options: PolicyRoutesOptions,
): Promise<void> {
  const { store, compiler } = options;

  const ROUTE_PREFIX = "/control/v1/merchants/:merchantId/policy";

  registerRoutePermission(`POST:${ROUTE_PREFIX}`, {
    permission: "identity.scope.read",
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
    const body = request.body as Record<string, unknown> | undefined;

    const validationError = validatePolicyBody(body);
    if (validationError !== undefined) {
      void reply.status(400).send({
        error: {
          code: "INVALID_FORMAT",
          message: validationError,
        },
      });
      return;
    }

    const typedBody = body as {
      policyVersion: string;
      rules: MerchantPolicyRule[];
      effectiveFrom: string;
      effectiveUntil?: string | null;
    };

    const config: MerchantPolicyConfig = {
      merchantId,
      policyVersion: typedBody.policyVersion,
      rules: typedBody.rules,
      effectiveFrom: typedBody.effectiveFrom,
      effectiveUntil: typedBody.effectiveUntil ?? null,
    };

    // Validate first
    const validationResult = compiler.validate(config);
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

    // Compile
    const compiled = compiler.compile(config);

    // Store with optimistic concurrency
    const storeResult = store.set(merchantId, config, expectedVersion);
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

    void reply.status(201).header("etag", String(storeResult.currentVersion)).send({
      merchantId,
      policyVersion: config.policyVersion,
      compiled,
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

    const entry = store.get(merchantId);
    if (entry === undefined) {
      void reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "No policy configured for this merchant",
        },
      });
      return;
    }

    void reply.header("etag", String(entry.version)).send({
      merchantId,
      policy: entry.config,
      correlationId,
    });
  });
}
