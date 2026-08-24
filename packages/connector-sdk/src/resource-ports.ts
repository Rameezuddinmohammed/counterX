/**
 * Resource read operation ports.
 *
 * Typed read interfaces for list, get, and search operations with
 * pagination support and freshness metadata on each observation.
 */

import type { ExternalReference, Instant } from "@counter/domain";

import type { FreshnessStatus } from "./freshness.js";

// ─── Parameters ───────────────────────────────────────────────────────────────

export interface ListParams {
  readonly cursor: string | null;
  readonly pageSize: number;
  readonly filters: Readonly<Record<string, string>>;
}

export interface SearchParams {
  readonly query: string;
  readonly filters: Readonly<Record<string, string>>;
  readonly limit: number;
  readonly offset: number;
}

// ─── Results ──────────────────────────────────────────────────────────────────

export interface ResourceObservation<T> {
  readonly data: T;
  readonly sourceReference: ExternalReference;
  readonly sourceVersion: string;
  readonly observedAt: Instant;
  readonly freshnessStatus: FreshnessStatus;
}

export interface PagedResult<T> {
  readonly items: readonly ResourceObservation<T>[];
  readonly nextCursor: string | null;
  readonly hasMore: boolean;
  readonly totalCount: number | undefined;
}

// ─── Port ─────────────────────────────────────────────────────────────────────

export interface ResourceReadPort<T> {
  list(params: ListParams): Promise<PagedResult<T>>;
  get(id: ExternalReference): Promise<ResourceObservation<T> | null>;
  search(query: SearchParams): Promise<PagedResult<T>>;
}
