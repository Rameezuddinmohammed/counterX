/**
 * Typed client interface for operator APIs.
 *
 * Provides stub implementations that return empty/mock data.
 * Real API integration comes later with control-plane-api endpoints.
 */
import type {
  AdapterReleaseStatus,
  DeadLetterEntry,
  FleetHealth,
  IncidentSummary,
  KillSwitchView,
  QueueStatus,
  SupportSessionView,
} from "./types";

/**
 * Operator API client interface.
 */
export interface OperatorApiClient {
  getFleetHealth(): Promise<readonly FleetHealth[]>;
  getIncidents(): Promise<readonly IncidentSummary[]>;
  getQueues(): Promise<readonly QueueStatus[]>;
  getDeadLetters(): Promise<readonly DeadLetterEntry[]>;
  getKillSwitches(): Promise<readonly KillSwitchView[]>;
  getSupportSessions(): Promise<readonly SupportSessionView[]>;
  getAdapterReleases(): Promise<readonly AdapterReleaseStatus[]>;
}

/**
 * Creates a stub operator API client that returns empty data.
 * Replace with real HTTP calls when control-plane-api endpoints are available.
 */
export function createOperatorApiClient(): OperatorApiClient {
  return Object.freeze({
    getFleetHealth(): Promise<readonly FleetHealth[]> {
      return Promise.resolve(Object.freeze([]));
    },

    getIncidents(): Promise<readonly IncidentSummary[]> {
      return Promise.resolve(Object.freeze([]));
    },

    getQueues(): Promise<readonly QueueStatus[]> {
      return Promise.resolve(Object.freeze([]));
    },

    getDeadLetters(): Promise<readonly DeadLetterEntry[]> {
      return Promise.resolve(Object.freeze([]));
    },

    getKillSwitches(): Promise<readonly KillSwitchView[]> {
      return Promise.resolve(Object.freeze([]));
    },

    getSupportSessions(): Promise<readonly SupportSessionView[]> {
      return Promise.resolve(Object.freeze([]));
    },

    getAdapterReleases(): Promise<readonly AdapterReleaseStatus[]> {
      return Promise.resolve(Object.freeze([]));
    },
  });
}
