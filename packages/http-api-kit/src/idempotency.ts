/**
 * Idempotency-Key header extraction middleware.
 *
 * For POST and PUT requests, extracts and validates the Idempotency-Key header.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import { createCanonicalError } from "@counter/domain";

const HEADER_NAME = "idempotency-key";
const MAX_KEY_LENGTH = 128;
const PRINTABLE_ASCII = /^[\x20-\x7E]+$/u;

const idempotencyKeys = new WeakMap<FastifyRequest, string>();

export function getIdempotencyKey(request: FastifyRequest): string | undefined {
  return idempotencyKeys.get(request);
}

export const idempotencyPlugin = fp(
  async (fastify: FastifyInstance): Promise<void> => {
    fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
      const method = request.method.toUpperCase();
      if (method !== "POST" && method !== "PUT") {
        return;
      }

      const headerValue = request.headers[HEADER_NAME];
      const raw = Array.isArray(headerValue) ? headerValue[0] : headerValue;

      if (raw === undefined || raw === "") {
        return;
      }

      if (raw.length > MAX_KEY_LENGTH || !PRINTABLE_ASCII.test(raw)) {
        const error = createCanonicalError({
          category: "validation",
          code: "INVALID_FORMAT",
          message: "Idempotency-Key must be 1-128 printable ASCII characters",
        });
        void reply.status(400).send({
          error: { code: error.code, message: error.message },
        });
        return reply;
      }

      idempotencyKeys.set(request, raw);
    });
  },
  { name: "counter-idempotency" },
);
