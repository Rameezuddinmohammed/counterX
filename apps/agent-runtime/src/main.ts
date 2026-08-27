/**
 * Deployment entry point for agent-runtime.
 * Binds to 0.0.0.0 so the Fly.io proxy can reach the server.
 */
import { createServer, APP_NAME } from "./index.js";

const port = parseInt(process.env["PORT"] || "8080", 10);

const environment = process.env["NODE_ENV"] || "production";

// Mock merchant handlers are only acceptable for local development / test.
// In production-like environments createServer will throw when no real
// handlers are supplied, so the process fails loudly at startup rather than
// silently serving mocked execution paths. Real handlers are not yet wired
// end-to-end here; when they are, pass them via `merchantHandlers` and drop
// this opt-in.
const allowMockHandlers = ["local", "test", "development"].includes(environment);

const server = createServer({
  logger: true,
  environment,
  version: process.env["APP_VERSION"] || "0.1.0",
  allowMockHandlers,
});

server.listen({ port, host: "0.0.0.0" }).then((address) => {
  console.log(`${APP_NAME} listening on ${address}`);
});

process.on("SIGTERM", () => {
  server.close();
});
