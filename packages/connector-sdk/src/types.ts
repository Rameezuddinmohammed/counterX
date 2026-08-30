/**
 * Core connector SDK type definitions.
 *
 * Declares the manifest shape that every connector must provide, including
 * resource declarations, action declarations, auth, rate limits, freshness,
 * event handling, idempotency, compensation, and data classification.
 */

import type { Instant } from "@counter/domain";

import type { TimeoutSemantics } from "./action-ports.js";

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const AUTH_METHODS = ["oauth", "api_key", "custom"] as const;
export type AuthMethod = (typeof AUTH_METHODS)[number];

export interface AuthDeclaration {
  readonly method: AuthMethod;
  readonly scopesRequired: readonly string[];
  readonly tokenRotation: boolean;
  readonly secretReferences: readonly string[];
}

// ─── Rate Limits ──────────────────────────────────────────────────────────────

export const RATE_LIMIT_STRATEGIES = ["fixed_window", "sliding_window", "token_bucket"] as const;
export type RateLimitStrategy = (typeof RATE_LIMIT_STRATEGIES)[number];

export const BACKOFF_POLICIES = ["exponential", "linear", "constant"] as const;
export type BackoffPolicy = (typeof BACKOFF_POLICIES)[number];

export interface RateLimitDeclaration {
  readonly strategy: RateLimitStrategy;
  readonly maxRequestsPerSecond: number;
  readonly costAwareThrottling: boolean;
  readonly backoffPolicy: BackoffPolicy;
}

// ─── Freshness ────────────────────────────────────────────────────────────────

export interface PerResourceBudget {
  readonly resourceName: string;
  readonly budgetMs: number;
}

export interface FreshnessDeclaration {
  readonly defaultBudgetMs: number;
  readonly perResourceBudgets: readonly PerResourceBudget[];
}

// ─── Events ───────────────────────────────────────────────────────────────────

export const EVENT_MODES = ["webhooks", "polling", "both"] as const;
export type EventMode = (typeof EVENT_MODES)[number];

export interface EventsDeclaration {
  readonly mode: EventMode;
  readonly topics: readonly string[];
  readonly deduplicationStrategy: string;
  readonly signatureVerification: boolean;
}

// ─── Resource Declaration ─────────────────────────────────────────────────────

export const SUPPORTED_OPERATIONS = ["list", "get", "search"] as const;
export type SupportedOperation = (typeof SUPPORTED_OPERATIONS)[number];

export interface PaginationConfig {
  readonly defaultPageSize: number;
  readonly maxPageSize: number;
  readonly cursorBased: boolean;
}

export interface ResourceDeclaration {
  readonly name: string;
  readonly schemaDescription: string;
  readonly supportedOperations: readonly SupportedOperation[];
  readonly pagination: PaginationConfig;
  readonly freshnessBudgetMs: number;
}

// ─── Action Declaration ───────────────────────────────────────────────────────

export const IDEMPOTENCY_STRATEGIES = [
  "native",
  "correlation_search",
  "workflow_uniqueness",
] as const;
export type IdempotencyStrategy = (typeof IDEMPOTENCY_STRATEGIES)[number];

export interface CompensationPath {
  readonly actionName: string;
  readonly description: string;
}

export interface ActionDeclaration {
  readonly name: string;
  readonly schemaDescription: string;
  readonly preconditions: readonly string[];
  readonly idempotencyStrategy: IdempotencyStrategy;
  readonly timeoutSemantics: TimeoutSemantics;
  readonly expectedEffects: readonly string[];
  readonly authorizationRequirements: readonly string[];
  readonly compensationPath: CompensationPath | null;
}

// ─── Data Classification ──────────────────────────────────────────────────────

export const DATA_CLASSIFICATIONS = ["public", "internal", "confidential", "restricted"] as const;
export type DataClassification = (typeof DATA_CLASSIFICATIONS)[number];

// ─── Sandbox Behavior ─────────────────────────────────────────────────────────

export interface SandboxBehavior {
  readonly useMockData: boolean;
  readonly simulateLatency: boolean;
  readonly maxLatencyMs: number;
}

// ─── Compensation Declaration ─────────────────────────────────────────────────

export interface CompensationDeclaration {
  readonly actionName: string;
  readonly compensatingAction: string;
  readonly timeWindowMs: number;
}

// ─── Connector Manifest ───────────────────────────────────────────────────────

export interface ConnectorManifest {
  readonly connectorId: string;
  readonly platform: string;
  readonly version: string;
  readonly resources: readonly ResourceDeclaration[];
  readonly actions: readonly ActionDeclaration[];
  readonly auth: AuthDeclaration;
  readonly rateLimits: RateLimitDeclaration;
  readonly freshness: FreshnessDeclaration;
  readonly events: EventsDeclaration;
  readonly sandboxBehavior: SandboxBehavior;
  readonly idempotencyStrategy: IdempotencyStrategy;
  readonly compensationDeclarations: readonly CompensationDeclaration[];
  readonly dataClassification: DataClassification;
  readonly createdAt: Instant;
}
