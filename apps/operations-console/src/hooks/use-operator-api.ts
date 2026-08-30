"use client";

import { useState, useCallback } from "react";
import { createOperatorApiClient } from "@/lib/operator-api-client";
import type {
  FleetHealth,
  IncidentSummary,
  QueueStatus,
  DeadLetterEntry,
  KillSwitchView,
  SupportSessionView,
  AdapterReleaseStatus,
} from "@/lib/types";

type ApiState<T> = {
  data: T | null;
  loading: boolean;
  error: string | null;
};

/**
 * Custom hook wrapping the operator API client with loading/error states.
 */
export function useOperatorApi() {
  const [fleet, setFleet] = useState<ApiState<readonly FleetHealth[]>>({
    data: null,
    loading: false,
    error: null,
  });
  const [incidents, setIncidents] = useState<ApiState<readonly IncidentSummary[]>>({
    data: null,
    loading: false,
    error: null,
  });
  const [queues, setQueues] = useState<ApiState<readonly QueueStatus[]>>({
    data: null,
    loading: false,
    error: null,
  });
  const [deadLetters, setDeadLetters] = useState<ApiState<readonly DeadLetterEntry[]>>({
    data: null,
    loading: false,
    error: null,
  });
  const [killSwitches, setKillSwitches] = useState<ApiState<readonly KillSwitchView[]>>({
    data: null,
    loading: false,
    error: null,
  });
  const [supportSessions, setSupportSessions] = useState<ApiState<readonly SupportSessionView[]>>({
    data: null,
    loading: false,
    error: null,
  });
  const [adapters, setAdapters] = useState<ApiState<readonly AdapterReleaseStatus[]>>({
    data: null,
    loading: false,
    error: null,
  });

  const client = createOperatorApiClient();

  const fetchFleet = useCallback(async () => {
    setFleet((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await client.getFleetHealth();
      setFleet({ data, loading: false, error: null });
    } catch (e) {
      setFleet({ data: null, loading: false, error: (e as Error).message });
    }
  }, []);

  const fetchIncidents = useCallback(async () => {
    setIncidents((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await client.getIncidents();
      setIncidents({ data, loading: false, error: null });
    } catch (e) {
      setIncidents({ data: null, loading: false, error: (e as Error).message });
    }
  }, []);

  const fetchQueues = useCallback(async () => {
    setQueues((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await client.getQueues();
      setQueues({ data, loading: false, error: null });
    } catch (e) {
      setQueues({ data: null, loading: false, error: (e as Error).message });
    }
  }, []);

  const fetchDeadLetters = useCallback(async () => {
    setDeadLetters((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await client.getDeadLetters();
      setDeadLetters({ data, loading: false, error: null });
    } catch (e) {
      setDeadLetters({ data: null, loading: false, error: (e as Error).message });
    }
  }, []);

  const fetchKillSwitches = useCallback(async () => {
    setKillSwitches((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await client.getKillSwitches();
      setKillSwitches({ data, loading: false, error: null });
    } catch (e) {
      setKillSwitches({ data: null, loading: false, error: (e as Error).message });
    }
  }, []);

  const fetchSupportSessions = useCallback(async () => {
    setSupportSessions((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await client.getSupportSessions();
      setSupportSessions({ data, loading: false, error: null });
    } catch (e) {
      setSupportSessions({ data: null, loading: false, error: (e as Error).message });
    }
  }, []);

  const fetchAdapters = useCallback(async () => {
    setAdapters((prev) => ({ ...prev, loading: true, error: null }));
    try {
      const data = await client.getAdapterReleases();
      setAdapters({ data, loading: false, error: null });
    } catch (e) {
      setAdapters({ data: null, loading: false, error: (e as Error).message });
    }
  }, []);

  const fetchAll = useCallback(async () => {
    await Promise.all([
      fetchFleet(),
      fetchIncidents(),
      fetchQueues(),
      fetchDeadLetters(),
      fetchKillSwitches(),
      fetchSupportSessions(),
      fetchAdapters(),
    ]);
  }, [
    fetchFleet,
    fetchIncidents,
    fetchQueues,
    fetchDeadLetters,
    fetchKillSwitches,
    fetchSupportSessions,
    fetchAdapters,
  ]);

  return {
    fleet,
    incidents,
    queues,
    deadLetters,
    killSwitches,
    supportSessions,
    adapters,
    fetchFleet,
    fetchIncidents,
    fetchQueues,
    fetchDeadLetters,
    fetchKillSwitches,
    fetchSupportSessions,
    fetchAdapters,
    fetchAll,
  };
}
