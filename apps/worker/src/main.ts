/**
 * Deployment entry point for worker.
 * Starts the worker loop with graceful shutdown on SIGTERM/SIGINT.
 */
import { APP_NAME } from "./index.js";

const HEARTBEAT_INTERVAL_MS = 60_000;

const heartbeat = setInterval(() => {
  console.log(`[${APP_NAME}] heartbeat - waiting for jobs`);
}, HEARTBEAT_INTERVAL_MS);

function shutdown(): void {
  console.log(`[${APP_NAME}] shutting down`);
  clearInterval(heartbeat);
  process.exit(0);
}

process.on("SIGTERM", shutdown);
process.on("SIGINT", shutdown);

console.log(`[${APP_NAME}] started`);
