import fc from "fast-check";
import {
  createCounterId,
  createExternalReference,
  instantFromEpochMilliseconds,
  merchantScope,
  platformScope,
  walletScope,
  type CounterId,
  type CounterIdKind,
  type Environment,
  type Instant,
  type MerchantScope,
  type Result,
} from "@counter/domain";
import { describe, expect, it } from "vitest";
import {
  AUTHENTICATION_ASSURANCES,
  PERMISSIONS,
  SUPPORT_GRANT_MAX_DURATION_MILLISECONDS,
  assurancePermits,
  authorize,
  createActorContext,
  createAgentPublicKeyRecord,
  createJobAuthorizationEnvelope,
  createServiceIdentityRecord,
  createSupportGrantRecord,
  isSupportGrantActiveAt,
  parseJobAuthorizationEnvelope,
  reauthorizeJob,
  type ActorContext,
  type AuthenticationAssurance,
  type Permission,
  type SupportGrantRecord,
} from "./index.js";

const baseTime = instant(1_750_000_000_000);
const merchantId = counterId("merchant", 1);
const otherMerchantId = counterId("merchant", 2);
const walletId = counterId("wallet", 3);
const operatorId = counterId("operator", 4);
const approvingOperatorId = counterId("operator", 5);
const correlationId = counterId("correlation", 6);

function merchantContext(
  options: Readonly<{
    environment?: Environment;
    scope?: MerchantScope;
    roles?: readonly ("merchant.owner" | "merchant.read_only")[];
    assurance?: "session" | "multi_factor" | "step_up";
  }> = {},
): ActorContext {
  const environment = options.environment ?? "test";
  const result = createActorContext({
    actor: { kind: "merchant_user", id: counterId("merchant-user", 7) },
    environment,
    scope: options.scope ?? merchantScope(environment, merchantId),
    assurance: options.assurance ?? "multi_factor",
    roles: options.roles ?? ["merchant.owner"],
    correlationId,
  });
  if (!result.ok) {
    throw new Error("test ActorContext was rejected");
  }
  return result.value;
}

function supportGrant(overrides: Partial<SupportGrantRecord> = {}): SupportGrantRecord {
  const approvalReference = createExternalReference("support-ticket", "SYNTHETIC-1001");
  if (!approvalReference.ok) {
    throw new Error("test support reference was rejected");
  }
  const targetScope = merchantScope("test", merchantId);
  const result = createSupportGrantRecord({
    supportGrantId: counterId("support-grant", 8),
    operatorId,
    environment: "test",
    targetScope,
    permissions: ["identity.actor.read"],
    reason: "customer_request",
    authorization: {
      kind: "approved",
      authorizedBy: approvingOperatorId,
      authorizedAt: instant(baseTime - 2_000),
      approvalReference: approvalReference.value,
    },
    issuedAt: instant(baseTime - 1_000),
    validFrom: baseTime,
    expiresAt: instant(baseTime + 60_000),
    ...overrides,
  });
  if (!result.ok) {
    throw new Error("test support grant was rejected");
  }
  return result.value;
}

function operatorContext(
  grant: SupportGrantRecord | undefined,
  assurance: "multi_factor" | "step_up" = "multi_factor",
): ActorContext {
  const input = {
    actor: { kind: "operator", id: operatorId } as const,
    environment: "test" as const,
    scope: platformScope("test"),
    assurance,
    roles: ["platform.operator"] as const,
    correlationId,
  };
  const result = createActorContext(
    grant === undefined ? input : { ...input, supportGrant: grant },
  );
  if (!result.ok) {
    throw new Error("test operator context was rejected");
  }
  return result.value;
}

describe("authentication assurance policy", () => {
  it("defines the intended assurance decision for every permission", () => {
    const tenantMutationAssurances = [
      "multi_factor",
      "step_up",
      "service_authenticated",
    ] as const satisfies readonly AuthenticationAssurance[];
    const supportAccessAssurances = [
      "multi_factor",
      "step_up",
    ] as const satisfies readonly AuthenticationAssurance[];
    const supportMutationAssurances = [
      "step_up",
    ] as const satisfies readonly AuthenticationAssurance[];
    const expectedAssurances: Readonly<Record<Permission, readonly AuthenticationAssurance[]>> = {
      "identity.scope.read": AUTHENTICATION_ASSURANCES,
      "identity.scope.manage": tenantMutationAssurances,
      "identity.actor.read": AUTHENTICATION_ASSURANCES,
      "identity.actor.manage": tenantMutationAssurances,
      "identity.role.read": AUTHENTICATION_ASSURANCES,
      "identity.role.assign": tenantMutationAssurances,
      "identity.agent_key.read": AUTHENTICATION_ASSURANCES,
      "identity.agent_key.manage": tenantMutationAssurances,
      "identity.service_identity.read": AUTHENTICATION_ASSURANCES,
      "identity.service_identity.manage": tenantMutationAssurances,
      "identity.support_grant.read": supportAccessAssurances,
      "identity.support_grant.issue": supportMutationAssurances,
      "identity.support_grant.revoke": supportMutationAssurances,
      "identity.support_grant.use": supportAccessAssurances,
      "payment.mandate.read": AUTHENTICATION_ASSURANCES,
      "payment.mandate.manage": tenantMutationAssurances,
      "payment.refund.read": AUTHENTICATION_ASSURANCES,
      "payment.refund.manage": tenantMutationAssurances,
    };

    for (const permission of PERMISSIONS) {
      for (const assurance of AUTHENTICATION_ASSURANCES) {
        expect(assurancePermits(assurance, permission)).toBe(
          expectedAssurances[permission].includes(assurance),
        );
      }
    }
  });
});

describe("platform tenant-scope provisioning", () => {
  const tenantScopes = [merchantScope("test", merchantId), walletScope("test", walletId)] as const;

  it("allows a step-up platform operator to provision merchant and wallet scopes grantlessly", () => {
    const context = operatorContext(undefined, "step_up");
    expect(context.permissions).toContain("identity.scope.manage");

    for (const scope of tenantScopes) {
      const result = authorize(context, {
        permission: "identity.scope.manage",
        environment: "test",
        scope,
        at: baseTime,
      });

      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.homeScope).toEqual(platformScope("test"));
        expect(result.value.effectiveScope).toEqual(scope);
        expect(result.value).not.toHaveProperty("supportGrantId");
      }
    }
  });

  it("requires both the platform operator role and step-up assurance", () => {
    for (const scope of tenantScopes) {
      expectUnauthorized(
        authorize(operatorContext(undefined, "multi_factor"), {
          permission: "identity.scope.manage",
          environment: "test",
          scope,
          at: baseTime,
        }),
      );
    }

    const roleless = createActorContext({
      actor: { kind: "operator", id: operatorId },
      environment: "test",
      scope: platformScope("test"),
      assurance: "step_up",
      roles: [],
      correlationId,
    });
    expect(roleless.ok).toBe(true);
    if (roleless.ok) {
      expectUnauthorized(
        authorize(roleless.value, {
          permission: "identity.scope.manage",
          environment: "test",
          scope: merchantScope("test", merchantId),
          at: baseTime,
        }),
      );
    }
  });

  it("does not turn step-up platform authority into ambient tenant access", () => {
    const context = operatorContext(undefined, "step_up");

    for (const scope of tenantScopes) {
      for (const permission of PERMISSIONS) {
        if (permission === "identity.scope.manage") {
          continue;
        }
        expectUnauthorized(
          authorize(context, {
            permission,
            environment: "test",
            scope,
            at: baseTime,
          }),
        );
      }
    }
  });

  it("does not use a support grant to bypass provisioning assurance", () => {
    expectUnauthorized(
      authorize(operatorContext(supportGrant(), "multi_factor"), {
        permission: "identity.scope.manage",
        environment: "test",
        scope: merchantScope("test", merchantId),
        at: baseTime,
      }),
    );
  });
});

describe("ActorContext", () => {
  it("derives an immutable permission set from closed role definitions", () => {
    const roles = ["merchant.owner"] as const;
    const result = createActorContext({
      actor: { kind: "merchant_user", id: counterId("merchant-user", 9) },
      environment: "test",
      scope: merchantScope("test", merchantId),
      assurance: "multi_factor",
      roles,
      correlationId,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.value.permissions).toContain("identity.actor.manage");
      expect(result.value.permissions).not.toContain("identity.support_grant.use");
      expect(Object.isFrozen(result.value)).toBe(true);
      expect(Object.isFrozen(result.value.permissions)).toBe(true);
      expect(Object.isFrozen(result.value.roles)).toBe(true);
    }
  });

  it("rejects actor/scope, environment, role, and assurance mismatches", () => {
    const actor = { kind: "merchant_user", id: counterId("merchant-user", 10) } as const;
    const validBase = {
      actor,
      environment: "test" as const,
      scope: merchantScope("test", merchantId),
      assurance: "multi_factor" as const,
      roles: ["merchant.owner"] as const,
      correlationId,
    };

    expect(createActorContext({ ...validBase, scope: walletScope("test", walletId) }).ok).toBe(
      false,
    );
    expect(createActorContext({ ...validBase, environment: "sandbox" }).ok).toBe(false);
    expect(createActorContext({ ...validBase, roles: ["platform.operator"] }).ok).toBe(false);
    expect(createActorContext({ ...validBase, assurance: "service_authenticated" }).ok).toBe(false);
  });
});

describe("deny-by-default authorization", () => {
  it("requires an assigned role, exact environment, and exact scope", () => {
    const target = merchantScope("test", merchantId);
    const roleless = merchantContext({ roles: [] });
    const request = {
      permission: "identity.actor.read" as const,
      environment: "test" as const,
      scope: target,
      at: baseTime,
    };

    expectUnauthorized(authorize(roleless, request));
    expectUnauthorized(
      authorize(merchantContext(), {
        ...request,
        scope: merchantScope("test", otherMerchantId),
      }),
    );
    expectUnauthorized(
      authorize(merchantContext(), {
        ...request,
        environment: "sandbox",
        scope: merchantScope("sandbox", merchantId),
      }),
    );
  });

  it("requires stronger assurance for identity mutation", () => {
    const request = {
      permission: "identity.actor.manage" as const,
      environment: "test" as const,
      scope: merchantScope("test", merchantId),
      at: baseTime,
    };

    expect(authorize(merchantContext({ assurance: "session" }), request).ok).toBe(false);
    expect(authorize(merchantContext({ assurance: "multi_factor" }), request).ok).toBe(true);
  });

  it("never treats platform operator scope as ambient tenant access", () => {
    const result = authorize(operatorContext(undefined), {
      permission: "identity.actor.read",
      environment: "test",
      scope: merchantScope("test", merchantId),
      at: baseTime,
    });

    expectUnauthorized(result);
  });

  it("allows only active, exact, read-only support overlays", () => {
    const grant = supportGrant();
    const context = operatorContext(grant);
    const read = authorize(context, {
      permission: "identity.actor.read",
      environment: "test",
      scope: merchantScope("test", merchantId),
      at: baseTime,
    });

    expect(read.ok).toBe(true);
    if (read.ok) {
      expect(read.value.supportGrantId).toBe(grant.supportGrantId);
      expect(read.value.effectiveScope).toEqual(merchantScope("test", merchantId));
    }
    expect(
      authorize(context, {
        permission: "identity.actor.manage",
        environment: "test",
        scope: merchantScope("test", merchantId),
        at: baseTime,
      }).ok,
    ).toBe(false);
    expect(
      authorize(context, {
        permission: "identity.actor.read",
        environment: "test",
        scope: merchantScope("test", otherMerchantId),
        at: baseTime,
      }).ok,
    ).toBe(false);
    expect(
      authorize(context, {
        permission: "identity.actor.read",
        environment: "test",
        scope: merchantScope("test", merchantId),
        at: grant.expiresAt,
      }).ok,
    ).toBe(false);
  });

  it("requires step-up assurance to issue or revoke support grants", () => {
    const request = {
      permission: "identity.support_grant.issue" as const,
      environment: "test" as const,
      scope: platformScope("test"),
      at: baseTime,
    };

    expect(authorize(operatorContext(undefined, "multi_factor"), request).ok).toBe(false);
    expect(authorize(operatorContext(undefined, "step_up"), request).ok).toBe(true);
  });

  it("property-checks merchant, Wallet, cross-kind, and environment isolation", () => {
    fc.assert(
      fc.property(
        fc.integer({ min: 0, max: 255 }),
        fc.constantFrom<Environment>("local", "test", "sandbox", "pilot", "production"),
        (seed, environment) => {
          const firstMerchant = counterId("merchant", seed);
          const secondMerchant = counterId("merchant", (seed + 1) % 256);
          const actorId = counterId("merchant-user", seed);
          const contextResult = createActorContext({
            actor: { kind: "merchant_user", id: actorId },
            environment,
            scope: merchantScope(environment, firstMerchant),
            assurance: "multi_factor",
            roles: ["merchant.owner"],
            correlationId: counterId("correlation", seed),
          });
          expect(contextResult.ok).toBe(true);
          if (!contextResult.ok) {
            return;
          }

          expect(
            authorize(contextResult.value, {
              permission: "identity.actor.read",
              environment,
              scope: merchantScope(environment, secondMerchant),
              at: baseTime,
            }).ok,
          ).toBe(false);
          expect(
            authorize(contextResult.value, {
              permission: "identity.actor.read",
              environment,
              scope: walletScope(environment, counterId("wallet", seed)),
              at: baseTime,
            }).ok,
          ).toBe(false);
          const otherEnvironment = environment === "test" ? "sandbox" : "test";
          expect(
            authorize(contextResult.value, {
              permission: "identity.actor.read",
              environment: otherEnvironment,
              scope: merchantScope(otherEnvironment, firstMerchant),
              at: baseTime,
            }).ok,
          ).toBe(false);
        },
      ),
    );
  });
});

describe("identity record validation", () => {
  it("accepts public Ed25519 material and rejects malformed encodings", () => {
    const valid = createAgentPublicKeyRecord({
      keyId: counterId("key", 11),
      agentId: counterId("agent", 12),
      environment: "test",
      scope: walletScope("test", walletId),
      algorithm: "Ed25519",
      publicKeyBase64Url: Buffer.alloc(32, 13).toString("base64url"),
      createdAt: baseTime,
      notBefore: baseTime,
    });
    const invalid = createAgentPublicKeyRecord({
      keyId: counterId("key", 14),
      agentId: counterId("agent", 15),
      environment: "test",
      scope: walletScope("test", walletId),
      algorithm: "Ed25519",
      publicKeyBase64Url: "not-a-public-key",
      createdAt: baseTime,
      notBefore: baseTime,
    });

    expect(valid.ok).toBe(true);
    expect(invalid.ok).toBe(false);
  });

  it("stores only an external service authentication binding", () => {
    const binding = createExternalReference("spiffe", "spiffe://counter.test/service/runtime");
    expect(binding.ok).toBe(true);
    if (!binding.ok) {
      return;
    }

    const result = createServiceIdentityRecord({
      serviceId: counterId("service", 16),
      environment: "test",
      scope: merchantScope("test", merchantId),
      authenticationBinding: binding.value,
      status: "active",
      createdAt: baseTime,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(Object.keys(result.value)).not.toContain("credential");
      expect(Object.keys(result.value)).not.toContain("secret");
    }
  });

  it("requires dual authorization, a bounded duration, and exact revocation state", () => {
    const valid = supportGrant();
    expect(isSupportGrantActiveAt(valid, valid.validFrom)).toBe(true);
    expect(isSupportGrantActiveAt(valid, valid.expiresAt)).toBe(false);

    expect(() =>
      supportGrant({
        expiresAt: instant(baseTime + SUPPORT_GRANT_MAX_DURATION_MILLISECONDS + 1),
      }),
    ).toThrow("test support grant was rejected");
    expect(() =>
      supportGrant({
        authorization: {
          ...valid.authorization,
          authorizedBy: operatorId,
        },
      }),
    ).toThrow("test support grant was rejected");
    expect(() => supportGrant({ revokedAt: baseTime })).toThrow("test support grant was rejected");
  });
});

describe("job authorization envelopes", () => {
  it("carries exact scope and requested permission but no trusted authority snapshot", () => {
    const serviceId = counterId("service", 17);
    const scope = merchantScope("test", merchantId);
    const contextResult = createActorContext({
      actor: { kind: "service", id: serviceId },
      environment: "test",
      scope,
      assurance: "service_authenticated",
      roles: ["service.identity"],
      correlationId,
    });
    expect(contextResult.ok).toBe(true);
    if (!contextResult.ok) {
      return;
    }
    const authorized = authorize(contextResult.value, {
      permission: "identity.actor.read",
      environment: "test",
      scope,
      at: baseTime,
    });
    expect(authorized.ok).toBe(true);
    if (!authorized.ok) {
      return;
    }

    const envelope = createJobAuthorizationEnvelope(authorized.value);
    expect(envelope.ok).toBe(true);
    if (!envelope.ok) {
      return;
    }
    expect(envelope.value).not.toHaveProperty("roles");
    expect(envelope.value).not.toHaveProperty("permissions");

    const parsed = parseJobAuthorizationEnvelope(
      JSON.parse(JSON.stringify(envelope.value)) as unknown,
    );
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) {
      return;
    }
    expect(reauthorizeJob(parsed.value, contextResult.value, baseTime).ok).toBe(true);

    const staleContext = createActorContext({
      actor: { kind: "service", id: serviceId },
      environment: "test",
      scope,
      assurance: "service_authenticated",
      roles: [],
      correlationId,
    });
    expect(staleContext.ok).toBe(true);
    if (staleContext.ok) {
      expect(reauthorizeJob(parsed.value, staleContext.value, baseTime).ok).toBe(false);
    }
  });

  it("rejects malformed or cross-service envelopes generically", () => {
    expectUnauthorized(
      parseJobAuthorizationEnvelope({
        serviceId: "ctr_service_not-canonical",
        environment: "test",
        scope: { kind: "platform" },
        correlationId,
        requiredPermission: "identity.actor.read",
      }),
    );
  });
});

function expectUnauthorized(result: Result<unknown>): void {
  expect(result.ok).toBe(false);
  if (!result.ok) {
    expect(result.error.code).toBe("UNAUTHORIZED");
  }
}

function counterId<Kind extends CounterIdKind>(kind: Kind, seed: number): CounterId<Kind> {
  const result = createCounterId(kind, new Uint8Array(16).fill(seed));
  if (!result.ok) {
    throw new Error(`Could not create ${kind} test ID`);
  }
  return result.value;
}

function instant(epochMilliseconds: number): Instant {
  const result = instantFromEpochMilliseconds(epochMilliseconds);
  if (!result.ok) {
    throw new Error("Could not create test Instant");
  }
  return result.value;
}
