/**
 * apps/reference-services
 *
 * Local REST merchant/provider fixtures only, visibly test-scoped.
 * Wraps the reference connector in a Fastify server for integration testing.
 */

export const APP_NAME = "@counter/reference-services";

export { buildServer } from "./server.js";

// ─── Direct Execution ─────────────────────────────────────────────────────────

export async function start(port = 3100): Promise<void> {
  const { buildServer } = await import("./server.js");
  const server = buildServer();
  await server.listen({ port, host: "0.0.0.0" });
  console.log(`${APP_NAME} listening on port ${String(port)}`);
}
