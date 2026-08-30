/**
 * Razorpay HTTP port interface and test double.
 *
 * Defines the contract for making authenticated HTTP calls to the
 * Razorpay API and provides a mock implementation for testing.
 * Uses Basic auth (key_id:key_secret) for server-side calls.
 * NEVER exposes key_secret in client-facing payloads.
 */

import type { RazorpayOrder, RazorpayPayment, RazorpayRefund } from "./types.js";

// ─── HTTP Port Interface ─────────────────────────────────────────────────────

export interface RazorpayHttpRequest {
  readonly method: "GET" | "POST" | "DELETE";
  readonly path: string;
  readonly body?: unknown;
  readonly idempotencyKey?: string;
}

export interface RazorpayHttpResponse<T = unknown> {
  readonly status: number;
  readonly body: T;
}

/**
 * Port interface for Razorpay HTTP communication.
 * Implementations handle authentication (Basic auth with key_id:key_secret)
 * and base URL resolution internally.
 */
export interface RazorpayHttpPort {
  request<T>(req: RazorpayHttpRequest): Promise<RazorpayHttpResponse<T>>;
}

// ─── Mock Implementation ─────────────────────────────────────────────────────

export interface MockResponse {
  readonly status: number;
  readonly body: unknown;
}

export type MockHandler = (req: RazorpayHttpRequest) => MockResponse | Promise<MockResponse>;

/**
 * Test double for RazorpayHttpPort.
 * Records all requests and allows configuring responses via handlers.
 */
export class MockRazorpayHttp implements RazorpayHttpPort {
  readonly #handlers: Map<string, MockHandler> = new Map();
  readonly #requests: RazorpayHttpRequest[] = [];
  #defaultHandler: MockHandler | null = null;

  /**
   * Register a handler for a specific path pattern.
   */
  public onPath(path: string, handler: MockHandler): void {
    this.#handlers.set(path, handler);
  }

  /**
   * Register a default handler for unmatched paths.
   */
  public onDefault(handler: MockHandler): void {
    this.#defaultHandler = handler;
  }

  /**
   * Configure a successful order creation response.
   */
  public onCreateOrder(order: RazorpayOrder): void {
    this.#handlers.set("/v1/orders", () => ({
      status: 200,
      body: order,
    }));
  }

  /**
   * Configure a successful payment query response.
   */
  public onQueryPayment(paymentId: string, payment: RazorpayPayment): void {
    this.#handlers.set(`/v1/payments/${paymentId}`, () => ({
      status: 200,
      body: payment,
    }));
  }

  /**
   * Configure a successful refund creation response.
   */
  public onCreateRefund(paymentId: string, refund: RazorpayRefund): void {
    this.#handlers.set(`/v1/payments/${paymentId}/refunds`, () => ({
      status: 200,
      body: refund,
    }));
  }

  /**
   * Configure a successful refund query response.
   */
  public onQueryRefund(paymentId: string, refundId: string, refund: RazorpayRefund): void {
    this.#handlers.set(`/v1/payments/${paymentId}/refunds/${refundId}`, () => ({
      status: 200,
      body: refund,
    }));
  }

  /**
   * Get all recorded requests.
   */
  public get requests(): readonly RazorpayHttpRequest[] {
    return [...this.#requests];
  }

  /**
   * Get the last recorded request.
   */
  public get lastRequest(): RazorpayHttpRequest | undefined {
    return this.#requests[this.#requests.length - 1];
  }

  /**
   * Clear all recorded requests.
   */
  public clearRequests(): void {
    this.#requests.length = 0;
  }

  public async request<T>(req: RazorpayHttpRequest): Promise<RazorpayHttpResponse<T>> {
    this.#requests.push(req);

    // Try exact match first
    const handler = this.#handlers.get(req.path);
    if (handler !== undefined) {
      const response = await handler(req);
      return response as RazorpayHttpResponse<T>;
    }

    // Try prefix match for parameterized paths
    for (const [pattern, patternHandler] of this.#handlers) {
      if (req.path.startsWith(pattern) || req.path === pattern) {
        const response = await patternHandler(req);
        return response as RazorpayHttpResponse<T>;
      }
    }

    // Default handler
    if (this.#defaultHandler !== null) {
      const response = await this.#defaultHandler(req);
      return response as RazorpayHttpResponse<T>;
    }

    return { status: 404, body: { error: "Not found" } as unknown as T };
  }
}
