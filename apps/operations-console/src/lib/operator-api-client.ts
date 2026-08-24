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
} from "./types.js";

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
    async getFleetHealth(): Promise<readonly FleetHealth[]> {
      return Object.freeze([]);
    },

    async getIncidents(): Promise<readonly IncidentSummary[]> {
      return Object.freeze([]);
    },

    async getQueues(): Promise<readonly QueueStatus[]> {
      return Object.freeze([]);
    },

    async getDeadLetters(): Promise<readonly DeadLetterEntry[]> {
      return Object.freeze([]);
    },

    async getKillSwitches(): Promise<readonly KillSwitchView[]> {
      return Object.freeze([]);
    },

    async getSupportSessions(): Promise<readonly SupportSessionView[]> {
      return Object.freeze([]);
    },

    async getAdapterReleases(): Promise<readonly AdapterReleaseStatus[]> {
      return Object.freeze([]);
    },
  });
}
