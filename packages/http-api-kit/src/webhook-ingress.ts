/**
 * Raw webhook ingress plugin.
 *
 * POST /webhooks/v1/{adapter}/* routes that preserve raw body for signature
 * verification. Content-type agnostic. No authentication middleware.
 * Includes payload size limits.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";

export interface WebhookHandler {
  (request: FastifyRequest, reply: FastifyReply): Promise<void>;
}

export interface WebhookIngressOptions {
  readonly maxPayloadBytes?: number;
  readonly adapters?: ReadonlyMap<string, WebhookHandler>;
}

const DEFAULT_MAX_PAYLOAD_BYTES = 1_048_576; // 1 MiB

const rawBodies = new WeakMap<FastifyRequest, Buffer>();

export function getRawBody(request: FastifyRequest): Buffer | undefined {
  return rawBodies.get(request);
}

/**
 * Webhook ingress plugin. This is intentionally NOT wrapped with fastify-plugin
 * because it registers its own content type parser that should be encapsulated.
 */
export async function webhookIngressPlugin(
  fastify: FastifyInstance,
  options?: WebhookIngressOptions,
): Promise<void> {
  const maxPayloadBytes = options?.maxPayloadBytes ?? DEFAULT_MAX_PAYLOAD_BYTES;
  const adapters = options?.adapters ?? new Map<string, WebhookHandler>();

  fastify.addContentTypeParser("*", { bodyLimit: maxPayloadBytes }, (_request, payload, done) => {
    const chunks: Buffer[] = [];
    let size = 0;

    payload.on("data", (chunk: Buffer) => {
      size += chunk.length;
      if (size > maxPayloadBytes) {
        done(new Error("Payload too large"), undefined);
        return;
      }
      chunks.push(chunk);
    });

    payload.on("end", () => {
      const body = Buffer.concat(chunks);
      done(null, body);
    });

    payload.on("error", (readError: Error) => {
      done(readError, undefined);
    });
  });

  fastify.post("/webhooks/v1/:adapter/*", async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { adapter: string };
    if (Buffer.isBuffer(request.body)) {
      rawBodies.set(request, request.body);
    }
    const handler = adapters.get(params.adapter);

    if (handler === undefined) {
      void reply.status(404).send({
        error: { code: "INVALID_FORMAT", message: "Unknown webhook adapter" },
      });
      return;
    }

    await handler(request, reply);
  });

  fastify.post("/webhooks/v1/:adapter", async (request: FastifyRequest, reply: FastifyReply) => {
    const params = request.params as { adapter: string };
    if (Buffer.isBuffer(request.body)) {
      rawBodies.set(request, request.body);
    }
    const handler = adapters.get(params.adapter);

    if (handler === undefined) {
      void reply.status(404).send({
        error: { code: "INVALID_FORMAT", message: "Unknown webhook adapter" },
      });
      return;
    }

    await handler(request, reply);
  });
}
