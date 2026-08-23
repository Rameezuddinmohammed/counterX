/**
 * apps/control-plane-api
 *
 * Merchant and Wallet configuration application: enrollment, policy, keys,
 * activation, and support grants under `/control/v1/...`. Console server
 * code invokes these application services rather than mutating domain
 * tables directly (see design.md "Deployable applications").
 *
 * Route/schema wiring, authentication middleware, and Fastify app
 * assembly are implemented starting in task 14. This placeholder proves
 * the package builds, type-checks, and tests through the toolchain, and
 * that `fastify` is resolvable from this app only (domain has no such
 * dependency, enforced by dependency-cruiser).
 */
import Fastify from "fastify";

export const APP_NAME = "@counter/control-plane-api";

export function createServer() {
  return Fastify({ logger: false });
}
