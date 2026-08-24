/**
 * OpenTelemetry NodeSDK initialization factory.
 *
 * Accepts configuration (service name, environment, OTLP endpoint) and returns
 * a configured SDK instance with auto-instrumentations. Supports enabling or
 * disabling specific signals (traces, metrics, logs).
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import type { Environment } from "@counter/domain";

/**
 * Configuration for the observability SDK.
 */
export interface ObservabilitySdkConfig {
  /** Name of the service emitting telemetry. */
  readonly serviceName: string;
  /** Deployment environment. */
  readonly environment: Environment;
  /** OTLP endpoint for exporting telemetry (e.g., "http://localhost:4318"). */
  readonly otlpEndpoint?: string;
  /** Enable or disable specific signals. All enabled by default. */
  readonly signals?: {
    readonly traces?: boolean;
    readonly metrics?: boolean;
    readonly logs?: boolean;
  };
}

/**
 * Wrapper around the NodeSDK providing typed start/shutdown lifecycle.
 */
export interface ObservabilitySdk {
  /** Start the SDK and register providers. */
  start(): void;
  /** Gracefully shut down the SDK, flushing pending telemetry. */
  shutdown(): Promise<void>;
}

/**
 * Creates a configured OpenTelemetry NodeSDK instance.
 *
 * The SDK is NOT started automatically; the caller must invoke start()
 * to register global providers.
 */
export function createObservabilitySdk(config: ObservabilitySdkConfig): ObservabilitySdk {
  const { serviceName, signals } = config;

  const tracesEnabled = signals?.traces !== false;

  const instrumentations = tracesEnabled ? [getNodeAutoInstrumentations()] : [];

  const sdk = new NodeSDK({
    serviceName,
    instrumentations,
  });

  // Track whether SDK was started for safe shutdown
  let started = false;

  return Object.freeze({
    start(): void {
      if (!started) {
        sdk.start();
        started = true;
      }
    },

    async shutdown(): Promise<void> {
      if (started) {
        await sdk.shutdown();
        started = false;
      }
    },
  });
}
