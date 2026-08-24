/**
 * Health check and readiness endpoints.
 *
 * GET /health - Liveness probe returning { status, version, environment }
 * GET /ready  - Readiness probe with dependency checks
 */
import type { FastifyInstance } from "fastify";
import fp from "fastify-plugin";

export interface HealthResponse {
  readonly status: "healthy";
  readonly version: string;
  readonly environment: string;
}

export interface ReadinessCheck {
  readonly database: boolean;
  readonly [key: string]: boolean;
}

export interface ReadinessResponse {
  readonly ready: boolean;
  readonly checks: ReadinessCheck;
}

export type ReadinessChecker = () => Promise<ReadinessCheck>;

export interface HealthPluginOptions {
  readonly version: string;
  readonly environment: string;
  readonly readinessChecker?: ReadinessChecker;
}

export const healthPlugin = fp(
  async (fastify: FastifyInstance, options: HealthPluginOptions): Promise<void> => {
    const { version, environment } = options;
    const readinessChecker = options.readinessChecker ?? defaultReadinessChecker;

    fastify.get("/health", async (_request, reply) => {
      const response: HealthResponse = {
        status: "healthy",
        version,
        environment,
      };
      void reply.status(200).send(response);
    });

    fastify.get("/ready", async (_request, reply) => {
      const checks = await readinessChecker();
      const ready = Object.values(checks).every((v) => v === true);
      const response: ReadinessResponse = { ready, checks };
      const status = ready ? 200 : 503;
      void reply.status(status).send(response);
    });
  },
  { name: "counter-health" },
);

async function defaultReadinessChecker(): Promise<ReadinessCheck> {
  return { database: true };
}
