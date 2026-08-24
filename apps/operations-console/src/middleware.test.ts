import { describe, expect, it } from "vitest";
import { middleware } from "./middleware.js";

/**
 * Minimal mock for NextRequest used in middleware tests.
 * We avoid importing from "next/server" in tests to keep them fast
 * and avoid Next.js internals. The middleware only uses .headers and .cookies.
 */
function createMockRequest(options: {
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
}): Parameters<typeof middleware>[0] {
  const headers = new Headers(options.headers ?? {});
  const cookies = {
    get(name: string) {
      const value = options.cookies?.[name];
      return value ? { name, value } : undefined;
    },
  };

  return {
    headers,
    cookies,
    nextUrl: { pathname: "/" },
  } as unknown as Parameters<typeof middleware>[0];
}

describe("Operations Console middleware", () => {
  it("returns 401 when no session header or cookie is present", async () => {
    const request = createMockRequest({});
    const response = middleware(request);

    expect(response.status).toBe(401);
    const body = (await response.json()) as { error: string };
    expect(body).toEqual({ error: "Operator authentication required" });
  });

  it("allows request through when x-operator-session header is present", () => {
    const request = createMockRequest({
      headers: { "x-operator-session": "session-token-abc" },
    });
    const response = middleware(request);

    // NextResponse.next() returns a response that continues the chain
    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("allows request through when counter_operator_session cookie is present", () => {
    const request = createMockRequest({
      cookies: { counter_operator_session: "session-token-xyz" },
    });
    const response = middleware(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("allows request through when both header and cookie are present", () => {
    const request = createMockRequest({
      headers: { "x-operator-session": "header-session" },
      cookies: { counter_operator_session: "cookie-session" },
    });
    const response = middleware(request);

    expect(response.status).toBe(200);
    expect(response.headers.get("x-middleware-next")).toBe("1");
  });

  it("returns 401 with correct content type", () => {
    const request = createMockRequest({});
    const response = middleware(request);

    expect(response.headers.get("content-type")).toContain("application/json");
  });

  it("rejects requests with empty session header", () => {
    const request = createMockRequest({
      headers: { "x-operator-session": "" },
    });
    const response = middleware(request);

    expect(response.status).toBe(401);
  });

  it("rejects requests with empty session cookie", () => {
    const request = createMockRequest({
      cookies: { counter_operator_session: "" },
    });
    const response = middleware(request);

    expect(response.status).toBe(401);
  });
});
