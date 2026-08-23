import { describe, expect, it, afterEach } from "vitest";
import { APP_NAME, createServer } from "./index.js";
import type { FastifyInstance } from "fastify";

describe("@counter/control-plane-api placeholder", () => {
  let server: FastifyInstance | undefined;

  afterEach(async () => {
    await server?.close();
    server = undefined;
  });

  it("exposes its app identity", () => {
    expect(APP_NAME).toBe("@counter/control-plane-api");
  });

  it("builds a Fastify instance", async () => {
    server = createServer();
    expect(server).toBeDefined();
    await server.ready();
  });
});
