"use client";

/**
 * Custom hook for API calls with loading/error/data states.
 *
 * Uses the existing api-client.ts with Auth0 token as bearer.
 */

import { useCallback, useEffect, useState } from "react";
import type { ApiResult, AuthTokenProvider, MerchantApiClient } from "@/lib/api-client";
import { createApiClient } from "@/lib/api-client";
import { decodeAccessTokenClaims } from "@/lib/access-token-claims";

// ---------------------------------------------------------------------------
// Token provider (uses Auth0 session in production)
// ---------------------------------------------------------------------------

class AuthError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AuthError";
  }
}

function createBrowserTokenProvider(): AuthTokenProvider {
  let cachedToken: string | null = null;

  return {
    async getToken(): Promise<string> {
      if (cachedToken) return cachedToken;

      // /auth/access-token is the real @auth0/nextjs-auth0 v4 SDK endpoint
      // (enabled by default, mounted by proxy.ts's auth0.middleware call —
      // see apps/merchant-console/src/proxy.ts). It returns { token, ... }
      // for the signed-in user's session, or 401 with no session.
      const res = await fetch("/auth/access-token");
      if (res.ok) {
        const data = (await res.json()) as Record<string, unknown>;
        const token = data["token"];
        if (typeof token === "string" && token.length > 0) {
          cachedToken = token;
          return cachedToken;
        }
      }

      throw new AuthError("Unable to obtain authentication token. Please sign in again.");
    },
    invalidate() {
      cachedToken = null;
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton API client
// ---------------------------------------------------------------------------

let tokenProviderInstance: AuthTokenProvider | null = null;
let apiClientInstance: MerchantApiClient | null = null;

function getTokenProvider(): AuthTokenProvider {
  if (!tokenProviderInstance) {
    tokenProviderInstance = createBrowserTokenProvider();
  }
  return tokenProviderInstance;
}

export function getApiClient(): MerchantApiClient {
  if (!apiClientInstance) {
    apiClientInstance = createApiClient({
      baseUrl:
        process.env["NEXT_PUBLIC_API_BASE_URL"] ??
        "https://counter-control-plane-api.fly.dev/control/v1",
      tokenProvider: getTokenProvider(),
      timeout: 15_000,
    });
  }
  return apiClientInstance;
}

// ---------------------------------------------------------------------------
// useCurrentMerchantId hook
// ---------------------------------------------------------------------------

/**
 * The real merchant id for the signed-in session, decoded from the same
 * access token every other API call already sends as its Authorization
 * header — not a hardcoded placeholder. control-plane-api still enforces
 * the real boundary server-side on every request (this is only for the
 * browser to know which merchant path to ask about); a mismatched or
 * absent merchant scope surfaces as `error` rather than silently falling
 * back to someone else's data.
 */
export interface CurrentMerchant {
  readonly merchantId: string | undefined;
  readonly loading: boolean;
  readonly error: string | null;
}

export function useCurrentMerchantId(): CurrentMerchant {
  const [merchantId, setMerchantId] = useState<string | undefined>(undefined);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const token = await getTokenProvider().getToken();
        const claims = decodeAccessTokenClaims(token);
        if (cancelled) return;
        if (claims?.scope?.kind === "merchant" && claims.scope.merchantId) {
          setMerchantId(claims.scope.merchantId);
        } else {
          setError("Your session isn't scoped to a merchant account.");
        }
      } catch (err) {
        if (!cancelled) {
          setError(err instanceof Error ? err.message : "Could not determine merchant account.");
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  return { merchantId, loading, error };
}

// ---------------------------------------------------------------------------
// useApi hook
// ---------------------------------------------------------------------------

export interface UseApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

export function useApi<T>(
  fetcher: (client: MerchantApiClient) => Promise<ApiResult<T>>,
  deps: unknown[] = [],
): UseApiState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetchData = useCallback(async () => {
    setLoading(true);
    setError(null);

    try {
      const client = getApiClient();
      const result = await fetcher(client);

      if (result.ok) {
        setData(result.data);
      } else {
        // On 401, invalidate token and retry once with a fresh token
        if (result.error.code === "UNAUTHORIZED") {
          getTokenProvider().invalidate();
          const retry = await fetcher(client);
          if (retry.ok) {
            setData(retry.data);
          } else {
            setError(retry.error.message);
          }
        } else {
          setError(result.error.message);
        }
      }
    } catch (err) {
      if (err instanceof AuthError) {
        setError(err.message);
      } else {
        setError(err instanceof Error ? err.message : "Unknown error");
      }
    } finally {
      setLoading(false);
    }
    // `deps` is this hook's own explicit refetch-trigger contract, supplied
    // by the caller — `fetcher` is deliberately excluded because every call
    // site passes a fresh inline closure per render; including it here would
    // recreate fetchData (and therefore refetch, via the effect below) on
    // every render instead of only when `deps` actually changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const refetch = useCallback(() => {
    void fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch };
}
