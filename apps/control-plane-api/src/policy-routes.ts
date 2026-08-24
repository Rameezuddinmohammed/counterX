/**
 * Policy management routes for the control plane API.
 *
 * Provides POST/GET /control/v1/merchants/:merchantId/policy endpoints
 * for configuring and querying merchant-specific policy rules.
 */
import type { FastifyInstance, FastifyRequest, FastifyReply } from "fastify";
import {
  getCorrelationId,
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

export interface PolicyStore {
  get(merchantId: string): MerchantPolicyConfig | undefined;
  set(merchantId: string, config: MerchantPolicyConfig): void;
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
  const policies = new Map<string, MerchantPolicyConfig>();
  return {
    get(merchantId: string) {
      return policies.get(merchantId);
    },
    set(merchantId: string, config: MerchantPolicyConfig) {
      policies.set(merchantId, config);
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

    // Compile
    const compiled = compiler.compile(config);

    // Store
    store.set(merchantId, config);

    void reply.status(201).send({
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
    const correlationId = getCorrelationId(request);

    const policy = store.get(merchantId);
    if (policy === undefined) {
      void reply.status(404).send({
        error: {
          code: "NOT_FOUND",
          message: "No policy configured for this merchant",
        },
      });
      return;
    }

    void reply.send({
      merchantId,
      policy,
      correlationId,
    });
  });
}
