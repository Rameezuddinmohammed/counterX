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

function createBrowserTokenProvider(): AuthTokenProvider {
  let cachedToken: string | null = null;

  return {
    async getToken(): Promise<string> {
      if (cachedToken) return cachedToken;

      try {
        const res = await fetch("/api/auth/me");
        if (res.ok) {
          const data = await res.json();
          cachedToken = data.accessToken ?? "demo-token";
          return cachedToken!;
        }
      } catch {
        // Fall through to demo token
      }

      cachedToken = "demo-token";
      return cachedToken;
    },
    invalidate() {
      cachedToken = null;
    },
  };
}

// ---------------------------------------------------------------------------
// Singleton API client
// ---------------------------------------------------------------------------

let apiClientInstance: MerchantApiClient | null = null;

export function getApiClient(): MerchantApiClient {
  if (!apiClientInstance) {
    apiClientInstance = createApiClient({
      baseUrl: "https://counter-control-plane-api.fly.dev/control/v1",
      tokenProvider: createBrowserTokenProvider(),
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
        setError(result.error.message);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unknown error");
    } finally {
      setLoading(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);

  useEffect(() => {
    void fetchData();
  }, [fetchData]);

  return { data, loading, error, refetch: fetchData };
}
