"use client";

/**
 * Custom hook for API calls with loading/error/data states.
 *
 * Uses the existing api-client.ts with Auth0 token as bearer.
 */

import { useCallback, useEffect, useState } from "react";
import type { ApiResult, AuthTokenProvider, MerchantApiClient } from "@/lib/api-client";
import { createApiClient } from "@/lib/api-client";

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

      const res = await fetch("/api/auth/me");
      if (res.ok) {
        const data = await res.json() as Record<string, unknown>;
        const token = data["accessToken"];
        if (typeof token === "string" && token.length > 0) {
          cachedToken = token;
          return cachedToken;
        }
      }

      throw new AuthError(
        "Unable to obtain authentication token. Please sign in again.",
      );
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
      baseUrl: "https://counter-control-plane-api.fly.dev/control/v1",
      tokenProvider: getTokenProvider(),
      timeout: 15_000,
    });
  }
  return apiClientInstance;
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
  }, deps);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  const refetch = useCallback(() => {
    void fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch };
}
