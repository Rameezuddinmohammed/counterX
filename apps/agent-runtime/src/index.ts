/**
 * apps/agent-runtime
 *
 * Latency-sensitive discovery/quote/transaction commands under
 * `/runtime/v1/...` (see design.md "Deployable applications"). Route
 * wiring and command handling are implemented starting in task 14; this
 * placeholder proves the app builds, type-checks, and tests through the
 * toolchain.
 */
import Fastify from "fastify";

export const APP_NAME = "@counter/agent-runtime";

export function createServer() {
  return Fastify({ logger: false });
}
