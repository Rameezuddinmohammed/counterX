/**
 * Actor extraction from JWT claims.
 *
 * Maps Auth0 JWT custom claims (under the https://counter.dev/ namespace)
 * to ActorContext via the authorization package's createActorContext.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import {
  createCanonicalError,
  type ActorKind,
  type ActorReference,
  type CorrelationId,
  type Environment,
  type MerchantId,
  type Scope,
  type WalletId,
} from "@counter/domain";
import {
  createActorContext,
  type ActorContext,
  type AuthenticationAssurance,
  type RoleKey,
} from "@counter/authorization";
import { getJwtPayload, type JwtPayload } from "./auth.js";
import { getCorrelationId } from "./correlation.js";

const CLAIMS_NAMESPACE = "https://counter.dev/";

const actorContexts = new WeakMap<FastifyRequest, ActorContext>();

export function getActorContext(request: FastifyRequest): ActorContext | undefined {
  return actorContexts.get(request);
}

function extractActorKind(payload: JwtPayload): ActorKind | undefined {
  const value = payload[`${CLAIMS_NAMESPACE}actor_kind`];
  if (typeof value !== "string") return undefined;
  const valid: readonly string[] = [
    "merchant_user",
    "wallet_user",
    "registered_agent",
    "operator",
    "service",
  ];
  if (!valid.includes(value)) return undefined;
  return value as ActorKind;
}

function extractEnvironment(payload: JwtPayload): Environment | undefined {
  const value = payload[`${CLAIMS_NAMESPACE}environment`];
  if (typeof value !== "string") return undefined;
  const valid: readonly string[] = ["local", "test", "sandbox", "pilot", "production"];
  if (!valid.includes(value)) return undefined;
  return value as Environment;
}

function extractScope(payload: JwtPayload, environment: Environment): Scope | undefined {
  const raw = payload[`${CLAIMS_NAMESPACE}scope`];
  if (typeof raw !== "object" || raw === null) return undefined;
  const obj = raw as Record<string, unknown>;
  const kind = obj["kind"];

  if (kind === "merchant" && typeof obj["merchantId"] === "string") {
    return Object.freeze({
      kind: "merchant",
      environment,
      merchantId: obj["merchantId"] as MerchantId,
    });
  }
  if (kind === "wallet" && typeof obj["walletId"] === "string") {
    return Object.freeze({
      kind: "wallet",
      environment,
      walletId: obj["walletId"] as WalletId,
    });
  }
  if (kind === "platform") {
    return Object.freeze({ kind: "platform", environment });
  }
  return undefined;
}

function extractRoles(payload: JwtPayload): readonly RoleKey[] {
  const value = payload[`${CLAIMS_NAMESPACE}roles`];
  if (!Array.isArray(value)) return [];
  return value.filter((r): r is RoleKey => typeof r === "string") as readonly RoleKey[];
}

function extractAssurance(payload: JwtPayload): AuthenticationAssurance {
  const explicit = payload[`${CLAIMS_NAMESPACE}assurance`];
  if (typeof explicit === "string") {
    const valid: readonly string[] = [
      "session",
      "multi_factor",
      "step_up",
      "agent_proof",
      "service_authenticated",
    ];
    if (valid.includes(explicit)) return explicit as AuthenticationAssurance;
  }

  // Step-up detection from standard claims
  const amr = payload.amr;
  if (Array.isArray(amr) && amr.includes("mfa")) {
    return "multi_factor";
  }

  return "session";
}

export interface ActorExtractionOptions {
  readonly skipRoutes?: readonly string[];
}

export const actorExtractionPlugin = fp(
  async (fastify: FastifyInstance, options: ActorExtractionOptions): Promise<void> => {
    const skipRoutes = options.skipRoutes ?? [];

    fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
      for (const route of skipRoutes) {
        if (request.url === route || request.url.startsWith(route + "/")) {
          return;
        }
      }

      const payload = getJwtPayload(request);
      if (payload === undefined) {
        return;
      }

      const actorKind = extractActorKind(payload);
      const environment = extractEnvironment(payload);

      if (actorKind === undefined || environment === undefined) {
        const error = createCanonicalError("UNAUTHENTICATED");
        void reply.status(401).send({
          error: { code: error.code, message: error.message },
        });
        return reply;
      }

      const scope = extractScope(payload, environment);
      if (scope === undefined) {
        const error = createCanonicalError("UNAUTHENTICATED");
        void reply.status(401).send({
          error: { code: error.code, message: error.message },
        });
        return reply;
      }

      const roles = extractRoles(payload);
      const assurance = extractAssurance(payload);
      const correlationId = getCorrelationId(request);

      const actor = Object.freeze({
        kind: actorKind,
        id: payload.sub,
      }) as unknown as ActorReference;

      const result = createActorContext({
        actor,
        environment,
        scope,
        assurance,
        roles,
        correlationId: correlationId as CorrelationId,
      });

      if (!result.ok) {
        const error = createCanonicalError("UNAUTHENTICATED");
        void reply.status(401).send({
          error: { code: error.code, message: error.message },
        });
        return reply;
      }

      actorContexts.set(request, result.value);
    });
  },
  { name: "counter-actor-extraction" },
);
