/**
 * Deployment entry point for control-plane-api.
 * Binds to 0.0.0.0 so the Fly.io proxy can reach the server.
 */
import { createServer, APP_NAME } from "./index.js";

const port = parseInt(process.env["PORT"] || "8080", 10);

const server = createServer({
  logger: true,
  environment: process.env["NODE_ENV"] || "production",
  version: process.env["APP_VERSION"] || "0.1.0",
});

server.listen({ port, host: "0.0.0.0" }).then((address) => {
  console.log(`${APP_NAME} listening on ${address}`);
});

process.on("SIGTERM", () => {
  server.close();
});
