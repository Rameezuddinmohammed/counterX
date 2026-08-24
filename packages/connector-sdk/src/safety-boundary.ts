/**
 * Safety boundary: type-level enforcement that connectors cannot execute
 * SQL or mutate domain state directly.
 *
 * The ConnectorContract interface only exposes resource read ports and action
 * ports. It never exposes database handles, query builders, or mutation
 * functions.
 *
 * Connectors can only return typed observations (what happened externally).
 * They cannot mutate domain state directly. All write paths go through
 * ActionPort which returns ActionOutcome (an observation of what happened),
 * never mutates state itself.
 *
 * The NoSqlAccess type resolves to `never`, blocking any attempt to pass
 * SQL query capabilities into the connector boundary at compile time.
 */

import type { ActionOutcome, ActionPort } from "./action-ports.js";
import type { ConnectorHealthPort } from "./health.js";
import type { ResourceReadPort } from "./resource-ports.js";
import type { ConnectorManifest } from "./types.js";

// ─── SQL Blocking ─────────────────────────────────────────────────────────────

/**
 * Type-level block for SQL injection paths. Any attempt to use SQL
 * capabilities within a connector will be blocked at compile time
 * because `never` cannot be satisfied.
 */
export type NoSqlAccess = never;

/**
 * Type-level block for direct domain state mutation. Connectors cannot
 * call write operations on domain aggregates. They can only observe
 * external system effects.
 */
export type NoDomainMutation = never;

// ─── Connector Contract ───────────────────────────────────────────────────────

/**
 * The contract that every connector must satisfy.
 *
 * The type-level constraint ensures:
 * 1. Only resource read ports (observation of external data) are exposed
 * 2. Only action ports (producing ActionOutcome observations) are exposed
 * 3. Health reporting is mandatory
 * 4. No database handles, query builders, or mutation functions can leak in
 * 5. The manifest describes what the connector claims to support
 *
 * TManifest is parameterized so the harness can verify the connector
 * actually implements what it declares.
 */
export interface ConnectorContract<TManifest extends ConnectorManifest> {
  readonly manifest: TManifest;

  /** Resource read ports keyed by resource name. Returns observations only. */
  readonly resources: Readonly<Record<string, ResourceReadPort<unknown>>>;

  /**
   * Action ports keyed by action name. Returns ActionOutcome observations only.
   * The connector never mutates domain state; it returns what the external
   * system did.
   */
  readonly actions: Readonly<Record<string, ActionPort<unknown, unknown>>>;

  /** Health reporting is mandatory for all connectors. */
  readonly health: ConnectorHealthPort;

  /**
   * Compile-time proof that no SQL access is provided.
   * This field exists only at the type level and can never be assigned a value.
   */
  readonly _sqlAccess?: NoSqlAccess;

  /**
   * Compile-time proof that no domain mutation is provided.
   * This field exists only at the type level and can never be assigned a value.
   */
  readonly _domainMutation?: NoDomainMutation;
}

// ─── Type assertions ──────────────────────────────────────────────────────────

/**
 * Verifies at the type level that an ActionPort only produces observations.
 * ActionOutcome is always a description of what happened, never a mutation.
 */
export type ActionProducesObservation<T> = T extends ActionPort<infer _I, infer R>
  ? ActionOutcome<R>
  : never;
