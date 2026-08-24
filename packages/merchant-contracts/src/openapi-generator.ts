/**
 * OpenAPI 3.1 specification generator for merchant runtime routes.
 *
 * Produces a deterministic JSON spec (sorted keys) from the route contracts.
 * This is a static generation - no runtime server is required.
 */

import { MERCHANT_ROUTES } from "./route-schemas.js";

export interface OpenApiSpec {
  readonly openapi: "3.1.0";
  readonly info: {
    readonly title: string;
    readonly version: string;
    readonly description: string;
  };
  readonly paths: Record<string, Record<string, unknown>>;
  readonly components: {
    readonly securitySchemes: Record<string, unknown>;
    readonly schemas: Record<string, unknown>;
  };
  readonly security: readonly Record<string, readonly string[]>[];
}

function sortObjectKeys(obj: unknown): unknown {
  if (obj === null || obj === undefined) return obj;
  if (Array.isArray(obj)) return obj.map(sortObjectKeys);
  if (typeof obj !== "object") return obj;
  const sorted: Record<string, unknown> = {};
  const keys = Object.keys(obj as Record<string, unknown>).sort();
  for (const key of keys) {
    sorted[key] = sortObjectKeys((obj as Record<string, unknown>)[key]);
  }
  return sorted;
}

function buildErrorSchema(code: string, message: string): Record<string, unknown> {
  return {
    type: "object",
    required: ["error"],
    properties: {
      error: {
        type: "object",
        required: ["code", "message"],
        properties: {
          code: { type: "string", const: code },
          message: { type: "string", const: message },
          details: { type: "object" },
        },
      },
    },
  };
}

function buildErrorResponses(codes: readonly number[]): Record<string, unknown> {
  const responses: Record<string, unknown> = {};

  for (const code of codes) {
    switch (code) {
      case 401:
        responses["401"] = {
          description: "Unauthorized - same response shape regardless of resource existence",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/UnauthorizedError" },
            },
          },
        };
        break;
      case 400:
        responses["400"] = {
          description: "Validation error with structured detail",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ValidationError" },
            },
          },
        };
        break;
      case 409:
        responses["409"] = {
          description: "Stale version conflict with current version for retry",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/StaleError" },
            },
          },
        };
        break;
      case 202:
        responses["202"] = {
          description: "Review required before operation can continue",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/ReviewRequiredResponse" },
            },
          },
        };
        break;
      case 502:
        responses["502"] = {
          description: "Indeterminate outcome - query before retry",
          content: {
            "application/json": {
              schema: { $ref: "#/components/schemas/IndeterminateError" },
            },
          },
        };
        break;
    }
  }

  return responses;
}

function routePathToOpenApiPath(path: string): string {
  return path.replace(/:(\w+)/g, "{$1}");
}

function buildPaths(): Record<string, Record<string, unknown>> {
  const paths: Record<string, Record<string, unknown>> = {};

  for (const route of MERCHANT_ROUTES) {
    const openApiPath = routePathToOpenApiPath(route.path);
    const method = route.method.toLowerCase();

    const parameters: Record<string, unknown>[] = [...buildPathParameters(route.path)];

    if (route.requiresIdempotency) {
      parameters.push({
        name: "idempotency-key",
        in: "header",
        required: true,
        schema: { type: "string", maxLength: 128 },
      });
    }

    if (route.requiresVersion) {
      parameters.push({
        name: "if-match",
        in: "header",
        required: route.method === "POST",
        schema: { type: "string" },
      });
    }

    const operation: Record<string, unknown> = {
      summary: route.description,
      tags: ["merchant"],
      security: [{ bearerAuth: [] }],
      parameters,
      responses: {
        "200": {
          description: "Successful response",
          content: { "application/json": { schema: { type: "object" } } },
        },
        ...buildErrorResponses(route.errorResponses),
      },
    };

    if (route.method === "POST") {
      operation["requestBody"] = {
        required: true,
        content: { "application/json": { schema: { type: "object" } } },
      };
    }

    if (paths[openApiPath] === undefined) {
      paths[openApiPath] = {};
    }
    (paths[openApiPath] as Record<string, unknown>)[method] = operation;
  }

  return paths;
}

function buildPathParameters(path: string): Record<string, unknown>[] {
  const params: Record<string, unknown>[] = [];
  const paramPattern = /:(\w+)/g;
  let match: RegExpExecArray | null;

  while ((match = paramPattern.exec(path)) !== null) {
    params.push({
      name: match[1],
      in: "path",
      required: true,
      schema: { type: "string" },
    });
  }

  // Always add correlation header
  params.push({
    name: "x-correlation-id",
    in: "header",
    required: false,
    schema: { type: "string" },
  });

  return params;
}

function buildComponentSchemas(): Record<string, unknown> {
  return {
    UnauthorizedError: buildErrorSchema("UNAUTHENTICATED", "Authentication is required"),
    ValidationError: {
      type: "object",
      required: ["error"],
      properties: {
        error: {
          type: "object",
          required: ["code", "message"],
          properties: {
            code: { type: "string", const: "INVALID_FORMAT" },
            message: { type: "string" },
            details: {
              type: "object",
              properties: {
                field: { type: "string" },
                constraint: { type: "string" },
              },
            },
          },
        },
      },
    },
    StaleError: {
      type: "object",
      required: ["error"],
      properties: {
        error: {
          type: "object",
          required: ["code", "message", "details"],
          properties: {
            code: { type: "string", const: "STALE" },
            message: { type: "string", const: "The request is based on stale state" },
            details: {
              type: "object",
              required: ["currentVersion", "requestedVersion"],
              properties: {
                currentVersion: { type: "string" },
                requestedVersion: { type: "string" },
              },
            },
          },
        },
      },
    },
    ReviewRequiredResponse: {
      type: "object",
      required: ["status", "reviewId", "reason", "blockingRuleIds", "correlationId"],
      properties: {
        status: { type: "string", const: "review_required" },
        reviewId: { type: "string" },
        reason: { type: "string" },
        blockingRuleIds: { type: "array", items: { type: "string" } },
        correlationId: { type: "string" },
      },
    },
    IndeterminateError: buildErrorSchema("INDETERMINATE", "The operation outcome is not yet authoritative"),
  };
}

/**
 * Generate the OpenAPI 3.1 specification for merchant runtime routes.
 * Output is deterministic (sorted keys) for stable diffing.
 */
export function generateOpenApiSpec(): OpenApiSpec {
  const spec = {
    openapi: "3.1.0" as const,
    info: {
      title: "Counter Merchant Runtime API",
      version: "1.0.0",
      description: "Merchant-facing runtime endpoints for capability discovery, search, quotes, transactions, and receipts.",
    },
    paths: buildPaths(),
    components: {
      securitySchemes: {
        bearerAuth: {
          type: "http",
          scheme: "bearer",
          bearerFormat: "JWT",
        },
      },
      schemas: buildComponentSchemas(),
    },
    security: [{ bearerAuth: [] as readonly string[] }],
  };

  return sortObjectKeys(spec) as OpenApiSpec;
}
