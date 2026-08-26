/**
 * apps/worker
 *
 * Outbox/job worker process: leases PostgreSQL jobs, invokes typed
 * adapters, runs reconciliation, and issues receipts (see design.md
 * "PostgreSQL jobs"). Implemented starting in task 10; this placeholder
 * proves the app builds, type-checks, and tests through the toolchain.
 */
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";

export const APP_NAME = "@counter/worker";

// --- Auto-start when executed directly (e.g., via Dockerfile CMD) ---
const isMainModule =
  resolve(process.argv[1] ?? "") === fileURLToPath(import.meta.url);

if (isMainModule) {
  const HEARTBEAT_INTERVAL_MS = 60_000;

  const heartbeat = setInterval(() => {
    console.log(`[${APP_NAME}] heartbeat - waiting for jobs`);
  }, HEARTBEAT_INTERVAL_MS);

  // Graceful shutdown on SIGTERM/SIGINT
  const shutdown = (): void => {
    console.log(`[${APP_NAME}] shutting down`);
    clearInterval(heartbeat);
    process.exit(0);
  };

  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);

  console.log(`[${APP_NAME}] started (port ${process.env["PORT"] || "N/A"})`);
}
