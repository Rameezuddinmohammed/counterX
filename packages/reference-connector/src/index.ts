/**
 * packages/reference-connector
 *
 * Generic REST reference connector for contract testing and certification.
 * Provides a baseline implementation of the connector-sdk ports that can
 * be used for testing and as a template for new connectors.
 */

export const PACKAGE_NAME = "@counter/reference-connector";

/** Manifest describing the reference connector capabilities. */
export interface ReferenceConnectorManifest {
  readonly connectorId: string;
  readonly platform: "reference";
  readonly version: string;
  readonly capabilities: readonly string[];
  readonly certificationLevel: string;
}

/** Controls for injecting faults during contract testing. */
export interface FaultControls {
  readonly enabled: boolean;
  readonly failureRate: number;
  readonly latencyMs: number;
  readonly errorCodes: readonly string[];
  readonly affectedOperations: readonly string[];
}
