/**
 * Deterministic mock implementation of ShopifyGraphQLPort for testing.
 *
 * Supports configurable responses via a response map, fault injection,
 * and call history tracking for test assertions.
 */

import type {
  ShopifyGraphQLPort,
  ShopifyGraphQLResponse,
  ShopifyThrottleStatus,
} from "./graphql-client.js";

// --- Call Record ---

export interface MockCallRecord {
  readonly type: "query" | "mutate";
  readonly operation: string;
  readonly variables: Record<string, unknown>;
  readonly timestamp: number;
}

// --- Fault Types ---

export type MockFault =
  | { readonly kind: "rate_limit"; readonly retryAfterMs: number }
  | { readonly kind: "auth_failure"; readonly message: string }
  | { readonly kind: "timeout"; readonly durationMs: number }
  | { readonly kind: "network_error"; readonly message: string };

// --- Mock Configuration ---

export interface MockGraphQLClientConfig {
  readonly responses?: ReadonlyMap<string, ShopifyGraphQLResponse<unknown>> | undefined;
  readonly defaultThrottleStatus?: ShopifyThrottleStatus | undefined;
  readonly fault?: MockFault | undefined;
}

// --- Default Throttle Status ---

const DEFAULT_THROTTLE_STATUS: ShopifyThrottleStatus = {
  currentlyAvailable: 900,
  restoreRate: 50,
  maximumAvailable: 1000,
};

// --- Mock Client Factory ---

export interface MockShopifyClient extends ShopifyGraphQLPort {
  readonly callHistory: readonly MockCallRecord[];
  setFault(fault: MockFault | undefined): void;
  setResponse(operation: string, response: ShopifyGraphQLResponse<unknown>): void;
  reset(): void;
}

export function createMockGraphQLClient(config?: MockGraphQLClientConfig): MockShopifyClient {
  const responses = new Map<string, ShopifyGraphQLResponse<unknown>>(config?.responses);
  const throttleStatus = config?.defaultThrottleStatus ?? DEFAULT_THROTTLE_STATUS;
  let currentFault: MockFault | undefined = config?.fault;
  const history: MockCallRecord[] = [];

  async function handleFault(): Promise<void> {
    if (!currentFault) return;

    switch (currentFault.kind) {
      case "rate_limit":
        throw new Error(`Rate limited. Retry after ${String(currentFault.retryAfterMs)}ms`);
      case "auth_failure":
        throw new Error(`Authentication failed: ${currentFault.message}`);
      case "timeout": {
        const ms = currentFault.durationMs;
        await new Promise((resolve) => setTimeout(resolve, ms));
        throw new Error("Request timed out");
      }
      case "network_error":
        throw new Error(`Network error: ${currentFault.message}`);
    }
  }

  function getResponse<T>(operation: string): ShopifyGraphQLResponse<T> {
    const configured = responses.get(operation);
    if (configured) {
      return configured as ShopifyGraphQLResponse<T>;
    }

    return {
      data: null,
      errors: [{ message: `No mock response configured for operation: ${operation}` }],
      extensions: {
        cost: { throttleStatus },
      },
    };
  }

  return {
    get callHistory(): readonly MockCallRecord[] {
      return history;
    },

    setFault(fault: MockFault | undefined): void {
      currentFault = fault;
    },

    setResponse(operation: string, response: ShopifyGraphQLResponse<unknown>): void {
      responses.set(operation, response);
    },

    reset(): void {
      history.length = 0;
      currentFault = undefined;
      responses.clear();
    },

    async query<T>(
      operation: string,
      variables: Record<string, unknown>,
    ): Promise<ShopifyGraphQLResponse<T>> {
      history.push({ type: "query", operation, variables, timestamp: Date.now() });
      await handleFault();
      return getResponse<T>(operation);
    },

    async mutate<T>(
      operation: string,
      variables: Record<string, unknown>,
    ): Promise<ShopifyGraphQLResponse<T>> {
      history.push({ type: "mutate", operation, variables, timestamp: Date.now() });
      await handleFault();
      return getResponse<T>(operation);
    },
  };
}
