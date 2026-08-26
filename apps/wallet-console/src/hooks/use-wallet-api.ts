"use client";

import { useState, useEffect, useCallback } from "react";
import {
  createPilotWalletClient,
  type WalletOverview,
  type WalletStatus,
} from "@/lib/wallet-client";

interface UseWalletApiState<T> {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
}

const client = createPilotWalletClient();

/**
 * Custom hook wrapping the wallet client with loading/error states.
 * In pilot mode, uses the MockWalletClient.
 * When Auth0 tokens are available, this can be extended to pass
 * bearer tokens to real API calls.
 */
export function useWalletOverview(walletId: string): UseWalletApiState<WalletOverview> {
  const [data, setData] = useState<WalletOverview | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(() => {
    setLoading(true);
    setError(null);

    // Simulate async fetch
    setTimeout(() => {
      const result = client.getOverview(walletId);
      if (result.ok) {
        setData(result.value);
      } else {
        setError(result.error.reason);
      }
      setLoading(false);
    }, 300);
  }, [walletId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}

export function useWalletStatus(walletId: string): UseWalletApiState<WalletStatus> {
  const [data, setData] = useState<WalletStatus | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const fetch = useCallback(() => {
    setLoading(true);
    setError(null);

    setTimeout(() => {
      const result = client.getStatus(walletId);
      if (result.ok) {
        setData(result.value);
      } else {
        setError(result.error.reason);
      }
      setLoading(false);
    }, 200);
  }, [walletId]);

  useEffect(() => {
    fetch();
  }, [fetch]);

  return { data, loading, error, refetch: fetch };
}
