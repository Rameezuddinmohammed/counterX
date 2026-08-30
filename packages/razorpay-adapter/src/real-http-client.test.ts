/**
 * Unit tests for the real fetch-based Razorpay HTTP client.
 *
 * These tests stub the global `fetch` (vi.stubGlobal) — NO real network is
 * touched. They verify:
 *  - Basic auth header derived from keyId:keySecret
 *  - X-Razorpay-Idempotency header sent when idempotencyKey provided
 *  - JSON body serialization + Content-Type on POST
 *  - Non-200 responses returned as-is (never thrown)
 *  - fetch rejection surfaced as a synthetic 503 unavailable outcome
 *  - AbortController timeout surfaced as an indeterminate 503 (reason=timeout)
 *  - Identical idempotency header across retries (retry-safety wiring)
 */

import { afterEach, describe, expect, it, vi } from "vitest";

import {
  createRazorpayHttpClient,
  redactAuthorization,
  RAZORPAY_IDEMPOTENCY_HEADER,
  TRANSPORT_UNAVAILABLE_STATUS,
  type TransportFailureBody,
} from "./real-http-client.js";

const CONFIG = {
  keyId: "rzp_test_key123",
  keySecret: "rzp_test_secret456",
  baseUrl: "https://api.razorpay.com/v1",
} as const;

/** Basic auth for the fixed test credentials, computed independently. */
const EXPECTED_AUTH = `Basic ${Buffer.from("rzp_test_key123:rzp_test_secret456", "utf8").toString("base64")}`;

function headerValue(init: RequestInit | undefined, name: string): string | undefined {
  const headers = (init?.headers ?? {}) as Record<string, string>;
  return headers[name];
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("createRazorpayHttpClient", () => {
  it("sends Basic auth derived from keyId:keySecret", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "order_abc" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createRazorpayHttpClient(CONFIG);
    await client.request({ method: "POST", path: "/orders", body: { amount: 100 } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(headerValue(init, "Authorization")).toBe(EXPECTED_AUTH);
  });

  it("targets baseUrl + path with the given method", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "pay_1" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createRazorpayHttpClient(CONFIG);
    await client.request({ method: "GET", path: "/payments/pay_1" });

    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe("https://api.razorpay.com/v1/payments/pay_1");
    expect(init.method).toBe("GET");
  });

  it("serializes POST body as JSON and sets Content-Type", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "order_abc" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createRazorpayHttpClient(CONFIG);
    await client.request({
      method: "POST",
      path: "/orders",
      body: { amount: 100, currency: "INR" },
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(headerValue(init, "Content-Type")).toBe("application/json");
    expect(init.body).toBe(JSON.stringify({ amount: 100, currency: "INR" }));
  });

  it("sends X-Razorpay-Idempotency header when idempotencyKey provided", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "order_abc" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createRazorpayHttpClient(CONFIG);
    await client.request({
      method: "POST",
      path: "/orders",
      body: { amount: 100 },
      idempotencyKey: "idem-key-xyz",
    });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(headerValue(init, RAZORPAY_IDEMPOTENCY_HEADER)).toBe("idem-key-xyz");
  });

  it("omits idempotency header when no idempotencyKey provided", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ id: "order_abc" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createRazorpayHttpClient(CONFIG);
    await client.request({ method: "POST", path: "/orders", body: { amount: 100 } });

    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(headerValue(init, RAZORPAY_IDEMPOTENCY_HEADER)).toBeUndefined();
  });

  it("returns { status, body } for a successful response", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ id: "order_abc", amount: 100 }), { status: 200 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = createRazorpayHttpClient(CONFIG);
    const result = await client.request<{ id: string; amount: number }>({
      method: "POST",
      path: "/orders",
      body: { amount: 100 },
    });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({ id: "order_abc", amount: 100 });
  });

  it("returns a 400 response as-is without throwing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(
        new Response(JSON.stringify({ error: { code: "BAD_REQUEST_ERROR" } }), { status: 400 }),
      );
    vi.stubGlobal("fetch", fetchMock);

    const client = createRazorpayHttpClient(CONFIG);
    const result = await client.request({ method: "POST", path: "/orders", body: {} });

    expect(result.status).toBe(400);
    expect(result.body).toEqual({ error: { code: "BAD_REQUEST_ERROR" } });
  });

  it("returns a 500 response as-is without throwing", async () => {
    const fetchMock = vi
      .fn()
      .mockResolvedValue(new Response(JSON.stringify({ error: "server" }), { status: 500 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createRazorpayHttpClient(CONFIG);
    const result = await client.request({ method: "GET", path: "/payments/pay_1" });

    expect(result.status).toBe(500);
    expect(result.body).toEqual({ error: "server" });
  });

  it("surfaces a fetch rejection as a synthetic 503 network-unavailable outcome", async () => {
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("fetch failed"));
    vi.stubGlobal("fetch", fetchMock);

    const client = createRazorpayHttpClient(CONFIG);
    const result = await client.request<TransportFailureBody>({
      method: "POST",
      path: "/orders",
      body: { amount: 100 },
    });

    expect(result.status).toBe(TRANSPORT_UNAVAILABLE_STATUS);
    expect(result.body.error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(result.body.error.reason).toBe("network");
  });

  it("treats an AbortController timeout as an indeterminate 503 (reason=timeout)", async () => {
    // Simulate fetch that never resolves until aborted, honoring the signal.
    const fetchMock = vi.fn().mockImplementation((_url: string, init: RequestInit) => {
      return new Promise((_resolve, reject) => {
        const signal = init.signal;
        if (signal) {
          signal.addEventListener("abort", () => {
            reject(new DOMException("The operation was aborted.", "AbortError"));
          });
        }
      });
    });
    vi.stubGlobal("fetch", fetchMock);

    const client = createRazorpayHttpClient({ ...CONFIG, timeoutMs: 5 });
    const result = await client.request<TransportFailureBody>({
      method: "POST",
      path: "/orders",
      body: { amount: 100 },
    });

    expect(result.status).toBe(TRANSPORT_UNAVAILABLE_STATUS);
    expect(result.body.error.code).toBe("PROVIDER_UNAVAILABLE");
    expect(result.body.error.reason).toBe("timeout");
  });

  it("sends the identical idempotency header across two retries with the same key", async () => {
    // Return a FRESH Response per call: a Response body can only be read once.
    const fetchMock = vi
      .fn()
      .mockImplementation(() => new Response(JSON.stringify({ id: "order_abc" }), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createRazorpayHttpClient(CONFIG);
    const req = {
      method: "POST" as const,
      path: "/orders",
      body: { amount: 100 },
      idempotencyKey: "retry-key-1",
    };
    await client.request(req);
    await client.request(req);

    const first = fetchMock.mock.calls[0] as [string, RequestInit];
    const second = fetchMock.mock.calls[1] as [string, RequestInit];
    expect(headerValue(first[1], RAZORPAY_IDEMPOTENCY_HEADER)).toBe("retry-key-1");
    expect(headerValue(second[1], RAZORPAY_IDEMPOTENCY_HEADER)).toBe("retry-key-1");
    expect(headerValue(first[1], RAZORPAY_IDEMPOTENCY_HEADER)).toBe(
      headerValue(second[1], RAZORPAY_IDEMPOTENCY_HEADER),
    );
  });

  it("tolerates an empty response body", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    const client = createRazorpayHttpClient(CONFIG);
    const result = await client.request({ method: "GET", path: "/payments/pay_1" });

    expect(result.status).toBe(200);
    expect(result.body).toEqual({});
  });
});

describe("redactAuthorization", () => {
  it("redacts the Authorization header and never leaks the secret", () => {
    const redacted = redactAuthorization({
      Authorization: EXPECTED_AUTH,
      Accept: "application/json",
    });
    expect(redacted["Authorization"]).toBe("Basic [REDACTED]");
    expect(redacted["Authorization"]).not.toContain("rzp_test_secret456");
    expect(redacted["Accept"]).toBe("application/json");
  });

  it("leaves headers without Authorization untouched", () => {
    const redacted = redactAuthorization({ Accept: "application/json" });
    expect(redacted).toEqual({ Accept: "application/json" });
  });
});
