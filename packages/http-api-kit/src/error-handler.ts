/**
 * Error handler that maps CanonicalError categories to HTTP status codes.
 *
 * Standard error response format:
 *   { error: { code: string, message: string } }
 *
 * Stack traces, internal paths, and secrets are never exposed.
 */
import type { FastifyInstance, FastifyReply, FastifyRequest } from "fastify";
import fp from "fastify-plugin";
import type { CanonicalError, CanonicalErrorCategory } from "@counter/domain";

export interface HttpErrorResponse {
  readonly error: {
    readonly code: string;
    readonly message: string;
  };
}

const categoryToStatus: Readonly<Record<CanonicalErrorCategory, number>> = {
  validation: 400,
  authentication: 401,
  authorization: 403,
  policy_denial: 422,
  conflict: 409,
  stale: 409,
  review_required: 422,
  unavailable: 503,
  retryable: 503,
  indeterminate: 202,
  internal: 500,
};

export function mapCanonicalErrorToStatus(category: CanonicalErrorCategory): number {
  return categoryToStatus[category];
}

function isCanonicalError(value: unknown): value is CanonicalError {
  return (
    typeof value === "object" &&
    value !== null &&
    "kind" in value &&
    (value as { kind: unknown }).kind === "canonical_error" &&
    "code" in value &&
    "category" in value &&
    "message" in value
  );
}

export function buildErrorResponse(error: CanonicalError): HttpErrorResponse {
  return { error: { code: error.code, message: error.message } };
}

export const errorHandlerPlugin = fp(
  async (fastify: FastifyInstance): Promise<void> => {
    fastify.setErrorHandler(
      (error: Error, _request: FastifyRequest, reply: FastifyReply) => {
        // If it is a Fastify validation error (from JSON Schema validation)
        if ("validation" in error && Array.isArray((error as { validation: unknown }).validation)) {
          void reply.status(400).send({
            error: {
              code: "INVALID_FORMAT",
              message: "Request validation failed",
            },
          });
          return;
        }

        // If the error has a CanonicalError attached (e.g., CanonicalHttpError)
        if ("canonicalError" in error && isCanonicalError((error as { canonicalError: unknown }).canonicalError)) {
          const canonical = (error as { canonicalError: CanonicalError }).canonicalError;
          const status = mapCanonicalErrorToStatus(canonical.category);
          void reply.status(status).send(buildErrorResponse(canonical));
          return;
        }

        // Unhandled internal error - never expose internals
        void reply.status(500).send({
          error: {
            code: "INTERNAL",
            message: "An internal error occurred",
          },
        });
      },
    );
  },
  { name: "counter-error-handler" },
);

/**
 * Helper to throw a CanonicalError-attached Error that the error handler
 * will intercept and map to the correct HTTP response.
 */
export class CanonicalHttpError extends Error {
  public readonly canonicalError: CanonicalError;

  public constructor(canonicalError: CanonicalError) {
    super(canonicalError.message);
    this.name = "CanonicalHttpError";
    this.canonicalError = canonicalError;
  }
}

export function throwCanonicalError(error: CanonicalError): never {
  throw new CanonicalHttpError(error);
}
