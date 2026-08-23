export const CANONICAL_ERROR_CATEGORIES = [
  "validation",
  "authentication",
  "authorization",
  "policy_denial",
  "conflict",
  "stale",
  "review_required",
  "unavailable",
  "retryable",
  "indeterminate",
  "internal",
] as const;

export type CanonicalErrorCategory = (typeof CANONICAL_ERROR_CATEGORIES)[number];
export type RetryDirective = "never" | "retry" | "query_before_retry";

interface CanonicalErrorDefinition {
  readonly category: CanonicalErrorCategory;
  readonly message: string;
  readonly retry: RetryDirective;
}

const canonicalErrorDefinitions = {
  INVALID_TYPE: {
    category: "validation",
    message: "Input has an invalid type",
    retry: "never",
  },
  INVALID_FORMAT: {
    category: "validation",
    message: "Input has an invalid canonical format",
    retry: "never",
  },
  UNSUPPORTED_VALUE: {
    category: "validation",
    message: "Input contains an unsupported value",
    retry: "never",
  },
  OUT_OF_RANGE: {
    category: "validation",
    message: "Input is outside the supported range",
    retry: "never",
  },
  OVERFLOW: {
    category: "validation",
    message: "Arithmetic exceeds the supported range",
    retry: "never",
  },
  CURRENCY_MISMATCH: {
    category: "validation",
    message: "Money currencies do not match",
    retry: "never",
  },
  UNIT_MISMATCH: {
    category: "validation",
    message: "Quantity units do not match",
    retry: "never",
  },
  ENVIRONMENT_MISMATCH: {
    category: "validation",
    message: "Environments do not match",
    retry: "never",
  },
  UNAUTHENTICATED: {
    category: "authentication",
    message: "Authentication is required",
    retry: "never",
  },
  UNAUTHORIZED: {
    category: "authorization",
    message: "The requested operation is not authorized",
    retry: "never",
  },
  POLICY_DENIED: {
    category: "policy_denial",
    message: "Policy does not permit the requested operation",
    retry: "never",
  },
  CONFLICT: {
    category: "conflict",
    message: "The request conflicts with existing state",
    retry: "never",
  },
  STALE: {
    category: "stale",
    message: "The request is based on stale state",
    retry: "never",
  },
  REVIEW_REQUIRED: {
    category: "review_required",
    message: "Review is required before the operation can continue",
    retry: "never",
  },
  UNAVAILABLE: {
    category: "unavailable",
    message: "The requested capability is unavailable",
    retry: "never",
  },
  RETRYABLE_FAILURE: {
    category: "retryable",
    message: "The operation can be retried safely",
    retry: "retry",
  },
  INDETERMINATE: {
    category: "indeterminate",
    message: "The operation outcome is not yet authoritative",
    retry: "query_before_retry",
  },
  INTERNAL: {
    category: "internal",
    message: "An internal error occurred",
    retry: "never",
  },
} as const satisfies Readonly<Record<string, CanonicalErrorDefinition>>;

export const CANONICAL_ERROR_CODES = [
  "INVALID_TYPE",
  "INVALID_FORMAT",
  "UNSUPPORTED_VALUE",
  "OUT_OF_RANGE",
  "OVERFLOW",
  "CURRENCY_MISMATCH",
  "UNIT_MISMATCH",
  "ENVIRONMENT_MISMATCH",
  "UNAUTHENTICATED",
  "UNAUTHORIZED",
  "POLICY_DENIED",
  "CONFLICT",
  "STALE",
  "REVIEW_REQUIRED",
  "UNAVAILABLE",
  "RETRYABLE_FAILURE",
  "INDETERMINATE",
  "INTERNAL",
] as const satisfies readonly (keyof typeof canonicalErrorDefinitions)[];

export type CanonicalErrorCode = keyof typeof canonicalErrorDefinitions;

type DefinitionFor<Code extends CanonicalErrorCode> = (typeof canonicalErrorDefinitions)[Code];

export type CanonicalErrorFor<Code extends CanonicalErrorCode> = Code extends CanonicalErrorCode
  ? Readonly<{
      kind: "canonical_error";
      code: Code;
      category: DefinitionFor<Code>["category"];
      message: DefinitionFor<Code>["message"];
      retry: DefinitionFor<Code>["retry"];
    }>
  : never;

export type CanonicalError = {
  readonly [Code in CanonicalErrorCode]: CanonicalErrorFor<Code>;
}[CanonicalErrorCode];

export type CanonicalErrorJson = CanonicalError;

export interface ReviewRequiredState {
  readonly kind: "review_required";
  readonly code: "REVIEW_REQUIRED";
  readonly message: "Review is required before the operation can continue";
  readonly ruleIds: readonly string[];
}

export interface IndeterminateState {
  readonly kind: "indeterminate";
  readonly code: "INDETERMINATE";
  readonly message: "The operation outcome is not yet authoritative";
  readonly reference: string;
}

export type CanonicalErrorInputFor<Code extends CanonicalErrorCode> = Readonly<{
  code: Code;
  category: DefinitionFor<Code>["category"];
  retry?: DefinitionFor<Code>["retry"];
  /** Internal diagnostic text is intentionally discarded at this boundary. */
  message?: string;
  /** Internal diagnostic values are intentionally discarded at this boundary. */
  details?: Readonly<Record<string, string | number | boolean | null>>;
}>;

export type CanonicalErrorInput = {
  readonly [Code in CanonicalErrorCode]: CanonicalErrorInputFor<Code>;
}[CanonicalErrorCode];

export function createCanonicalError<Code extends CanonicalErrorCode>(
  input: Code,
): CanonicalErrorFor<Code>;
export function createCanonicalError(input: CanonicalErrorInput): CanonicalError;
export function createCanonicalError(
  input: CanonicalErrorCode | CanonicalErrorInput,
): CanonicalError {
  const code = typeof input === "string" ? input : input.code;
  const definition = canonicalErrorDefinitions[code];
  return Object.freeze({
    kind: "canonical_error",
    code,
    category: definition.category,
    message: definition.message,
    retry: definition.retry,
  }) as CanonicalError;
}

/** Re-derives public fields from the stable code and never copies caller diagnostics. */
export function canonicalErrorToJson(error: {
  readonly code: CanonicalErrorCode;
}): CanonicalErrorJson {
  return createCanonicalError(error.code);
}

export function createReviewRequired(ruleIds: readonly string[]): ReviewRequiredState {
  return Object.freeze({
    kind: "review_required",
    code: "REVIEW_REQUIRED",
    message: "Review is required before the operation can continue",
    ruleIds: Object.freeze([...ruleIds]),
  });
}

export function createIndeterminate(reference: string): IndeterminateState {
  return Object.freeze({
    kind: "indeterminate",
    code: "INDETERMINATE",
    message: "The operation outcome is not yet authoritative",
    reference,
  });
}
