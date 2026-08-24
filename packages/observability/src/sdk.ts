/**
 * OpenTelemetry NodeSDK initialization factory.
 *
 * Accepts configuration (service name, environment, signal toggles) and returns
 * a configured SDK instance with auto-instrumentations. The `signals` config
 * controls which instrumentations are registered:
 * - `traces`: enables/disables auto-instrumentations (default: true)
 * - `metrics`: reserved for future metric pipeline registration (default: true)
 * - `logs`: reserved for future log pipeline registration (default: true)
 *
 * OTLP export configuration is handled via the standard OTEL_EXPORTER_OTLP_ENDPOINT
 * environment variable, which the underlying SDK reads automatically. There is no
 * explicit otlpEndpoint config field because programmatic exporter creation requires
 * additional optional dependencies (@opentelemetry/exporter-trace-otlp-http) that
 * are not bundled here. Set the env var in deployment manifests instead.
 */
import { NodeSDK } from "@opentelemetry/sdk-node";
import { Resource } from "@opentelemetry/resources";
import { ATTR_SERVICE_NAME } from "@opentelemetry/semantic-conventions";
import { getNodeAutoInstrumentations } from "@opentelemetry/auto-instrumentations-node";
import type { Environment } from "@counter/domain";

/** Semantic convention attribute for deployment environment name. */
const ATTR_DEPLOYMENT_ENVIRONMENT = "deployment.environment";

/**
 * Configuration for the observability SDK.
 */
export interface ObservabilitySdkConfig {
  /** Name of the service emitting telemetry. */
  readonly serviceName: string;
  /** Deployment environment (attached as a resource attribute). */
  readonly environment: Environment;
  /**
   * Enable or disable specific signal pipelines. All enabled by default.
   *
   * - traces: controls whether auto-instrumentations are registered
   * - metrics: controls whether the metrics pipeline is active (currently
   *   only disables metric instrument creation intent; full meter provider
   *   toggling requires additional OTel SDK wiring in a future iteration)
   * - logs: controls whether the logs pipeline is active (currently
   *   informational; full log provider toggling requires additional OTel
   *   SDK wiring in a future iteration)
   */
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
 *
 * OTLP export is configured via the OTEL_EXPORTER_OTLP_ENDPOINT environment
 * variable (e.g., "http://localhost:4318"). The SDK reads this automatically.
 */
export function createObservabilitySdk(config: ObservabilitySdkConfig): ObservabilitySdk {
  const { serviceName, environment, signals } = config;

  const tracesEnabled = signals?.traces !== false;
  // metrics and logs signal toggles are accepted for future pipeline registration.
  // When wired, these will control MeterProvider/LoggerProvider instantiation.

  const instrumentations = tracesEnabled ? [getNodeAutoInstrumentations()] : [];

  const resource = new Resource({
    [ATTR_SERVICE_NAME]: serviceName,
    [ATTR_DEPLOYMENT_ENVIRONMENT]: environment,
  });

  const sdkConfig: ConstructorParameters<typeof NodeSDK>[0] = {
    resource,
    instrumentations,
  };

  const sdk = new NodeSDK(sdkConfig);

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
