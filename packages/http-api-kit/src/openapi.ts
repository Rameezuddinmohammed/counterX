/**
 * OpenAPI 3.1 spec generation.
 *
 * Collects registered Fastify routes via the onRoute hook and generates
 * an OpenAPI 3.1 spec. Exposed at GET /docs/openapi.json in non-production
 * environments only.
 */
import type { FastifyInstance, RouteOptions } from "fastify";
import fp from "fastify-plugin";

export interface OpenApiInfo {
  readonly title: string;
  readonly version: string;
  readonly description?: string;
}

export interface OpenApiPluginOptions {
  readonly info: OpenApiInfo;
  readonly environment: string;
}

interface CollectedRoute {
  readonly url: string;
  readonly method: string;
}

export const openApiPlugin = fp(
  async (fastify: FastifyInstance, options: OpenApiPluginOptions): Promise<void> => {
    const { info, environment } = options;

    // Only expose in non-production environments
    if (environment === "production") {
      return;
    }

    const collectedRoutes: CollectedRoute[] = [];

    fastify.addHook("onRoute", (routeOptions: RouteOptions) => {
      const methods = Array.isArray(routeOptions.method)
        ? routeOptions.method
        : [routeOptions.method];
      for (const m of methods) {
        collectedRoutes.push({ url: routeOptions.url, method: m.toLowerCase() });
      }
    });

    fastify.get("/docs/openapi.json", async (_request, reply) => {
      const paths: Record<string, Record<string, unknown>> = {};

      for (const route of collectedRoutes) {
        let pathEntry = paths[route.url];
        if (pathEntry === undefined) {
          pathEntry = {};
          paths[route.url] = pathEntry;
        }
        pathEntry[route.method] = {
          responses: {
            "200": { description: "Success" },
          },
        };
      }

      const spec = {
        openapi: "3.1.0",
        info: {
          title: info.title,
          version: info.version,
          ...(info.description !== undefined ? { description: info.description } : {}),
        },
        paths,
      };

      void reply.header("content-type", "application/json").status(200).send(spec);
    });
  },
  { name: "counter-openapi" },
);
