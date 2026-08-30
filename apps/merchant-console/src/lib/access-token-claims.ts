/**
 * Client-safe decoder for the `https://counter.dev/` namespaced claims on
 * the access token this console already sends as its Authorization header
 * on every real API call (see hooks/use-api.ts's createBrowserTokenProvider).
 *
 * No signature verification here — control-plane-api verifies the token for
 * real on every request; this is purely so the browser can know which
 * merchant it's acting on behalf of, instead of guessing via a hardcoded
 * placeholder id. Mirrors apps/onboarding/src/lib/id-token-claims.ts's
 * decodeIdTokenClaims, but uses atob() since this runs in the browser, not
 * a Node server component.
 */

const CLAIMS_NAMESPACE = "https://counter.dev/";

export interface AccessTokenScope {
  readonly kind: string;
  readonly merchantId?: string;
  readonly walletId?: string;
}

export interface AccessTokenClaims {
  readonly actorKind?: string | undefined;
  readonly environment?: string | undefined;
  readonly scope?: AccessTokenScope | undefined;
  readonly roles?: readonly string[] | undefined;
  readonly assurance?: string | undefined;
}

function base64UrlDecode(segment: string): string {
  const base64 = segment.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64 + "=".repeat((4 - (base64.length % 4)) % 4);
  const binary = atob(padded);
  const percentEncoded = Array.from(
    binary,
    (char) => "%" + char.charCodeAt(0).toString(16).padStart(2, "0"),
  ).join("");
  return decodeURIComponent(percentEncoded);
}

/** Returns undefined on any malformed token rather than throwing — callers treat that as "not merchant-scoped yet". */
export function decodeAccessTokenClaims(token: string): AccessTokenClaims | undefined {
  try {
    const payloadSegment = token.split(".")[1];
    if (payloadSegment === undefined) return undefined;
    const payload = JSON.parse(base64UrlDecode(payloadSegment)) as Record<string, unknown>;
    return {
      actorKind: payload[`${CLAIMS_NAMESPACE}actor_kind`] as string | undefined,
      environment: payload[`${CLAIMS_NAMESPACE}environment`] as string | undefined,
      scope: payload[`${CLAIMS_NAMESPACE}scope`] as AccessTokenScope | undefined,
      roles: payload[`${CLAIMS_NAMESPACE}roles`] as readonly string[] | undefined,
      assurance: payload[`${CLAIMS_NAMESPACE}assurance`] as string | undefined,
    };
  } catch {
    return undefined;
  }
}
