/**
 * Redaction utilities for telemetry data.
 *
 * Ensures secrets, PII, credentials, and raw payment data are never emitted
 * in logs, span attributes, or metric labels. Applies both pattern-based
 * matching (credit cards, emails, phones) and key-name-based matching
 * (authorization headers, API keys, passwords, tokens).
 */

/** Keys whose values are always redacted regardless of content. */
const SENSITIVE_KEY_PATTERNS: readonly RegExp[] = Object.freeze([
  /password/iu,
  /secret/iu,
  /token/iu,
  /api[_-]?key/iu,
  /authorization/iu,
  /auth[_-]?header/iu,
  /credential/iu,
  /private[_-]?key/iu,
  /access[_-]?key/iu,
  /session[_-]?id/iu,
  /cookie/iu,
  /bearer/iu,
  /ssn/iu,
  /social[_-]?security/iu,
  /card[_-]?number/iu,
  /cvv/iu,
  /cvc/iu,
  /(?:^|[^a-z])pin(?:$|[^a-z])/iu,
]);

/** Value patterns that indicate sensitive data. */
const SENSITIVE_VALUE_PATTERNS: readonly {
  readonly pattern: RegExp;
  readonly replacement: string;
}[] = Object.freeze([
  {
    pattern: /\b\d{4}[- ]?\d{4}[- ]?\d{4}[- ]?\d{4}\b/gu,
    replacement: "[REDACTED_CARD]",
  },
  {
    pattern: /\b\d{4}[- ]?\d{6}[- ]?\d{5}\b/gu,
    replacement: "[REDACTED_CARD]",
  },
  {
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gu,
    replacement: "[REDACTED_EMAIL]",
  },
  {
    pattern: /(?:\+\d{1,3}[-.\s]?)?\(\d{3}\)[-.\s]?\d{3}[-.\s]?\d{4}\b/gu,
    replacement: "[REDACTED_PHONE]",
  },
  {
    pattern: /\+\d{1,3}[-.\s]?\d{3}[-.\s]?\d{3}[-.\s]?\d{4}\b/gu,
    replacement: "[REDACTED_PHONE]",
  },
  {
    pattern: /Bearer\s+[A-Za-z0-9\-._~+/]+=*/gu,
    replacement: "Bearer [REDACTED]",
  },
  {
    pattern: /Basic\s+[A-Za-z0-9+/]+=*/gu,
    replacement: "Basic [REDACTED]",
  },
]);

export const REDACTED = "[REDACTED]";

/**
 * Determines whether a key name indicates a sensitive field.
 */
export function isSensitiveKey(key: string): boolean {
  return SENSITIVE_KEY_PATTERNS.some((pattern) => pattern.test(key));
}

/**
 * Redacts a single value based on both the key name and value patterns.
 * Returns the original value if safe, or a redacted placeholder.
 */
export function redactValue(key: string, value: unknown): unknown {
  if (value === null || value === undefined) {
    return value;
  }

  if (isSensitiveKey(key)) {
    return REDACTED;
  }

  if (typeof value === "string") {
    return redactString(value);
  }

  return value;
}

/**
 * Applies value-based pattern redaction to a string.
 */
export function redactString(value: string): string {
  let result = value;
  for (const { pattern, replacement } of SENSITIVE_VALUE_PATTERNS) {
    // Reset regex state for global patterns
    pattern.lastIndex = 0;
    result = result.replace(pattern, replacement);
  }
  return result;
}

/**
 * Deep-walks an object and redacts all sensitive keys and value patterns.
 * Returns a new object with redacted values (never mutates the input).
 *
 * Uses a WeakSet to detect circular references and avoid stack overflow.
 * When a previously-visited node is encountered, returns "[CIRCULAR]".
 */
export function redactObject(obj: unknown, seen: WeakSet<object> = new WeakSet<object>()): unknown {
  if (obj === null || obj === undefined) {
    return obj;
  }

  if (typeof obj === "string") {
    return redactString(obj);
  }

  if (typeof obj !== "object") {
    return obj;
  }

  if (seen.has(obj)) {
    return "[CIRCULAR]";
  }
  seen.add(obj);

  if (Array.isArray(obj)) {
    return obj.map((item) => redactObject(item, seen));
  }

  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
    if (isSensitiveKey(key)) {
      result[key] = REDACTED;
    } else if (typeof value === "object" && value !== null) {
      result[key] = redactObject(value, seen);
    } else if (typeof value === "string") {
      result[key] = redactString(value);
    } else {
      result[key] = value;
    }
  }
  return result;
}
