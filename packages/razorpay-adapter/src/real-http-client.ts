/**
 * Real fetch-based Razorpay HTTP client.
 *
 * Implements {@link RazorpayHttpPort} against the live Razorpay REST API using
 * the global `fetch`. This is the production counterpart to
 * {@link MockRazorpayHttp}: it performs authenticated calls to
 * `${baseUrl}${path}` (e.g. https://api.razorpay.com/v1/orders).
 *
 * Contract notes (must match what RazorpayTestProvider expects):
 *  - `request<T>()` returns `{ status, body }` for ALL HTTP responses,
 *    including non-2xx. It does NOT throw on 4xx/5xx. The provider inspects
 *    `status` and maps non-200 to explicit outcomes (UNAVAILABLE for order /
 *    refund creation, pending for queries). Throwing here would collapse those
 *    distinct outcomes into a generic failure.
 *  - Transport failures (DNS/connection errors, fetch rejection, or an
 *    AbortController timeout) are surfaced as a synthetic
 *    `{ status: 503, body: { error: { ... } } }` so the caller treats them as
 *    provider-unavailable rather than a silent success. A timeout is
 *    INDETERMINATE by nature (the request may have reached Razorpay), so it is
 *    reported with a distinguishable `reason: "timeout"` marker in the body;
 *    callers must NOT assume the operation did or did not take effect.
 *
 * SECURITY: The Authorization header carries Basic auth derived from
 * `keyId:keySecret`. This module NEVER logs keyId, keySecret, or the
 * Authorization header. The {@link redactAuthorization} helper is exported so
 * any diagnostic logging elsewhere can scrub the header.
 */

import type {
  RazorpayHttpPort,
  RazorpayHttpRequest,
  RazorpayHttpResponse,
} from "./http-client.js";

/** Configuration for the real fetch-based Razorpay HTTP client. */
export interface RealRazorpayHttpConfig {
  readonly keyId: string;
  readonly keySecret: string;
  readonly baseUrl: string;
  /** Optional bounded per-request timeout in milliseconds. Defaults to 15000. */
  readonly timeoutMs?: number;
}

/**
 * The Razorpay idempotency header. Sending the same key on retries prevents
 * Razorpay from double-creating orders/refunds.
 */
export const RAZORPAY_IDEMPOTENCY_HEADER = "X-Razorpay-Idempotency";

/** Default bounded per-request timeout (milliseconds). */
export const DEFAULT_REQUEST_TIMEOUT_MS = 15_000;

/** Synthetic status used to signal a transport-level failure to the caller. */
export const TRANSPORT_UNAVAILABLE_STATUS = 503;

/**
 * Shape of the synthetic body returned when a transport failure occurs. The
 * `reason` field distinguishes an indeterminate timeout ("timeout") from a
 * hard connection failure ("network").
 */
export interface TransportFailureBody {
  readonly error: {
    readonly code: "PROVIDER_UNAVAILABLE";
    readonly reason: "timeout" | "network";
    readonly description: string;
  };
}

/**
 * Redacts the Authorization header from a headers-like record for safe logging.
 * Never returns the credential material.
 */
export function redactAuthorization(
  headers: Readonly<Record<string, string>>,
): Record<string, string> {
  const copy: Record<string, string> = { ...headers };
  if (copy["Authorization"] !== undefined) {
    copy["Authorization"] = "Basic [REDACTED]";
  }
  return copy;
}

/** Encodes `keyId:keySecret` as an HTTP Basic auth credential. */
function encodeBasicAuth(keyId: string, keySecret: string): string {
  return `Basic ${Buffer.from(`${keyId}:${keySecret}`, "utf8").toString("base64")}`;
}

/**
 * Creates a real fetch-based {@link RazorpayHttpPort}.
 *
 * The returned port authenticates every call with Basic auth, sends the
 * Razorpay idempotency header for retry-safety when an idempotency key is
 * provided, and enforces a bounded request timeout via {@link AbortController}.
 */
export function createRazorpayHttpClient(config: RealRazorpayHttpConfig): RazorpayHttpPort {
  const authorization = encodeBasicAuth(config.keyId, config.keySecret);
  const timeoutMs = config.timeoutMs ?? DEFAULT_REQUEST_TIMEOUT_MS;

  async function request<T>(req: RazorpayHttpRequest): Promise<RazorpayHttpResponse<T>> {
    const url = `${config.baseUrl}${req.path}`;

    const headers: Record<string, string> = {
      Authorization: authorization,
      Accept: "application/json",
    };

    let bodyInit: string | undefined;
    if (req.method === "POST" && req.body !== undefined) {
      headers["Content-Type"] = "application/json";
      bodyInit = JSON.stringify(req.body);
    }

    if (req.idempotencyKey !== undefined) {
      headers[RAZORPAY_IDEMPOTENCY_HEADER] = req.idempotencyKey;
    }

    const controller = new AbortController();
    const timer = setTimeout(() => {
      controller.abort();
    }, timeoutMs);

    let response: Response;
    try {
      const init: RequestInit = {
        method: req.method,
        headers,
        signal: controller.signal,
      };
      if (bodyInit !== undefined) {
        init.body = bodyInit;
      }
      response = await fetch(url, init);
    } catch (_cause) {
      // Transport-level failure: fetch rejected (DNS/connection) or the request
      // was aborted by our timeout. Surface as a synthetic unavailable response
      // rather than throwing, so the provider maps it to an explicit outcome.
      const aborted = controller.signal.aborted;
      const failureBody: TransportFailureBody = {
        error: {
          code: "PROVIDER_UNAVAILABLE",
          reason: aborted ? "timeout" : "network",
          description: aborted
            ? "Razorpay request timed out; outcome is indeterminate"
            : "Razorpay request failed at the transport layer",
        },
      };
      return { status: TRANSPORT_UNAVAILABLE_STATUS, body: failureBody as unknown as T };
    } finally {
      clearTimeout(timer);
    }

    const parsed = await parseBody<T>(response);
    return { status: response.status, body: parsed };
  }

  return { request };
}

/**
 * Parses a fetch Response body as JSON, tolerating empty bodies and non-JSON
 * payloads (returned as `{ raw: string }`). Never throws.
 */
async function parseBody<T>(response: Response): Promise<T> {
  const text = await response.text();
  if (text.length === 0) {
    return {} as unknown as T;
  }
  try {
    return JSON.parse(text) as T;
  } catch {
    return { raw: text } as unknown as T;
  }
}
