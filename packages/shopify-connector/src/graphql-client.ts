/**
 * Shopify Admin GraphQL client port interface.
 *
 * Defines the contract for communicating with the Shopify Admin API
 * via GraphQL operations. Implementations include a real HTTP adapter
 * and a deterministic mock for testing.
 */

// --- Throttle Status ---

export interface ShopifyThrottleStatus {
  readonly currentlyAvailable: number;
  readonly restoreRate: number;
  readonly maximumAvailable: number;
}

// --- GraphQL Error ---

export interface ShopifyGraphQLError {
  readonly message: string;
  readonly locations?: readonly { readonly line: number; readonly column: number }[] | undefined;
  readonly path?: readonly string[] | undefined;
  readonly extensions?: Readonly<Record<string, unknown>> | undefined;
}

// --- GraphQL Response ---

export interface ShopifyGraphQLResponse<T> {
  readonly data: T | null;
  readonly errors: readonly ShopifyGraphQLError[] | undefined;
  readonly extensions:
    | {
        readonly cost: {
          readonly throttleStatus: ShopifyThrottleStatus;
        };
      }
    | undefined;
}

// --- Port Interface ---

export interface ShopifyGraphQLPort {
  query<T>(
    operation: string,
    variables: Record<string, unknown>,
  ): Promise<ShopifyGraphQLResponse<T>>;

  mutate<T>(
    operation: string,
    variables: Record<string, unknown>,
  ): Promise<ShopifyGraphQLResponse<T>>;
}
