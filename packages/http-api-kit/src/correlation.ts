/**
 * Correlation ID middleware.
 *
 * Accepts an existing correlation ID from the X-Correlation-ID request header
 * or generates a new CounterId<"correlation"> when absent. The correlation ID
 * is attached to the request for downstream consumption and included in every
 * response via the same header.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { CryptoIdGenerator, type CorrelationId } from "@counter/domain";

const HEADER_NAME = "x-correlation-id";
const correlationIdPattern = /^ctr_correlation_[A-Za-z0-9_-]{22}$/u;

const correlationIds = new WeakMap<FastifyRequest, CorrelationId>();

export function getCorrelationId(request: FastifyRequest): CorrelationId {
  const id = correlationIds.get(request);
  if (id === undefined) {
    throw new Error("Correlation ID not available; ensure correlationPlugin is registered");
  }
  return id;
}

export const correlationPlugin = fp(
  async (fastify: FastifyInstance): Promise<void> => {
    const idGenerator = new CryptoIdGenerator();

    fastify.addHook("onRequest", async (request: FastifyRequest, _reply: FastifyReply) => {
      const headerValue = request.headers[HEADER_NAME];
      const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;

      let correlationId: CorrelationId;
      if (typeof raw === "string" && correlationIdPattern.test(raw)) {
        correlationId = raw as CorrelationId;
      } else {
        correlationId = idGenerator.generate("correlation");
      }

      correlationIds.set(request, correlationId);
    });

    fastify.addHook("onSend", async (request: FastifyRequest, reply: FastifyReply, payload) => {
      const id = correlationIds.get(request);
      if (id !== undefined) {
        void reply.header(HEADER_NAME, id);
      }
      return payload;
    });
  },
  { name: "counter-correlation" },
);
