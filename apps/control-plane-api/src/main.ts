/**
 * Deployment entry point for control-plane-api.
 * Unconditionally starts the server on the configured port.
 */
import { startServer, APP_NAME } from "./index.js";

const DEFAULT_VERSION = "0.1.0";
const port = parseInt(process.env["PORT"] || "8080", 10);

const server = startServer({
  logger: true,
  environment: process.env["NODE_ENV"] || "production",
  version: process.env["APP_VERSION"] || DEFAULT_VERSION,
});

server.listen({ port, host: "0.0.0.0" }).then((address) => {
  server.log.info(`${APP_NAME} listening on ${address}`);
});
