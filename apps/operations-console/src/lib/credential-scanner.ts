/**
 * Credential scanner for the operations console.
 *
 * Scans storage and telemetry payloads for patterns matching
 * forbidden credential fields to prevent secret leakage.
 *
 * The FORBIDDEN_CREDENTIAL_FIELDS list is defined locally
 * (mirroring @counter/payment-sdk) to avoid cross-package imports
 * in this Next.js app.
 */

// ─── Forbidden Fields (mirrored from payment-sdk) ───────────────────────────────

/**
 * Fields that must never be persisted in storage or telemetry.
 * Matches the FORBIDDEN_CREDENTIAL_FIELDS from @counter/payment-sdk.
 */
export const FORBIDDEN_CREDENTIAL_FIELDS: readonly string[] = Object.freeze([
  "api_key",
  "api_secret",
  "secret_key",
  "private_key",
  "client_secret",
  "webhook_secret",
  "access_token",
  "refresh_token",
  "password",
  "auth_token",
  "bearer_token",
  "signing_key",
  "encryption_key",
  "merchant_secret",
  "payout_key",
]);

// ─── Types ─────────────────────────────────────────────────────────────────────

/**
 * Severity of a credential scan finding.
 */
export type ScanSeverity = "critical" | "high" | "medium" | "low";

/**
 * A single finding from a credential scan.
 */
export interface ScanFinding {
  readonly field: string;
  readonly location: string;
  readonly severity: ScanSeverity;
  readonly context: string;
  readonly remediation: string;
}

/**
 * Result of a credential scan.
 */
export interface ScanResult {
  readonly scanId: string;
  readonly scanType: "storage" | "telemetry";
  readonly scannedAt: string;
  readonly totalRecordsScanned: number;
  readonly findings: readonly ScanFinding[];
  readonly clean: boolean;
}

/**
 * Port for storage access (dependency injection).
 */
export interface StoragePort {
  listKeys(prefix: string): Promise<readonly string[]>;
  getValue(key: string): Promise<Record<string, unknown> | null>;
}

/**
 * Port for telemetry access (dependency injection).
 */
export interface TelemetryPort {
  getRecentLogEntries(count: number): Promise<readonly Record<string, unknown>[]>;
  getRecentMetricPayloads(count: number): Promise<readonly Record<string, unknown>[]>;
}

// ─── Pattern Matching ───────────────────────────────────────────────────────────

/**
 * Checks if a key matches any forbidden credential field pattern.
 * Case-insensitive matching with common separators (_, -, .).
 */
export function matchesForbiddenPattern(key: string): string | null {
  const normalizedKey = key.toLowerCase().replace(/[-.\s]/g, "_");
  for (const field of FORBIDDEN_CREDENTIAL_FIELDS) {
    if (normalizedKey === field || normalizedKey.endsWith(`_${field}`) || normalizedKey.startsWith(`${field}_`)) {
      return field;
    }
  }
  return null;
}

/**
 * Recursively scans an object for keys matching forbidden patterns.
 */
export function scanObjectForCredentials(
  obj: Record<string, unknown>,
  path: string = "",
): readonly ScanFinding[] {
  const findings: ScanFinding[] = [];

  for (const [key, value] of Object.entries(obj)) {
    const currentPath = path ? `${path}.${key}` : key;
    const matchedField = matchesForbiddenPattern(key);

    if (matchedField && value !== undefined && value !== null && value !== "") {
      findings.push({
        field: matchedField,
        location: currentPath,
        severity: determineSeverity(matchedField),
        context: `Key "${key}" matches forbidden credential pattern "${matchedField}"`,
        remediation: `Remove or redact the value at "${currentPath}". Credential data must not be stored in plaintext.`,
      });
    }

    // Recurse into nested objects
    if (value !== null && typeof value === "object" && !Array.isArray(value)) {
      findings.push(
        ...scanObjectForCredentials(value as Record<string, unknown>, currentPath),
      );
    }

    // Recurse into arrays
    if (Array.isArray(value)) {
      for (let i = 0; i < value.length; i++) {
        const item = value[i];
        if (item !== null && typeof item === "object") {
          findings.push(
            ...scanObjectForCredentials(item as Record<string, unknown>, `${currentPath}[${i}]`),
          );
        }
      }
    }
  }

  return findings;
}

// ─── Scan Functions ─────────────────────────────────────────────────────────────

/**
 * Scans storage for credential patterns.
 * Uses the StoragePort to access stored data without coupling to a specific backend.
 */
export async function scanStorageForCredentials(
  storage: StoragePort,
  prefix: string = "",
): Promise<ScanResult> {
  const scanId = `scan-storage-${Date.now()}`;
  const keys = await storage.listKeys(prefix);
  const allFindings: ScanFinding[] = [];
  let totalScanned = 0;

  for (const key of keys) {
    const value = await storage.getValue(key);
    if (value !== null) {
      totalScanned++;
      const findings = scanObjectForCredentials(value, key);
      allFindings.push(...findings);
    }
  }

  return Object.freeze({
    scanId,
    scanType: "storage" as const,
    scannedAt: new Date().toISOString(),
    totalRecordsScanned: totalScanned,
    findings: Object.freeze(allFindings),
    clean: allFindings.length === 0,
  });
}

/**
 * Scans telemetry payloads (logs and metrics) for credential patterns.
 * Uses the TelemetryPort to access log/metric data.
 */
export async function scanTelemetryForCredentials(
  telemetry: TelemetryPort,
  entryCount: number = 100,
): Promise<ScanResult> {
  const scanId = `scan-telemetry-${Date.now()}`;
  const allFindings: ScanFinding[] = [];

  const [logEntries, metricPayloads] = await Promise.all([
    telemetry.getRecentLogEntries(entryCount),
    telemetry.getRecentMetricPayloads(entryCount),
  ]);

  let totalScanned = 0;

  for (let i = 0; i < logEntries.length; i++) {
    totalScanned++;
    const findings = scanObjectForCredentials(logEntries[i]!, `log[${i}]`);
    allFindings.push(...findings);
  }

  for (let i = 0; i < metricPayloads.length; i++) {
    totalScanned++;
    const findings = scanObjectForCredentials(metricPayloads[i]!, `metric[${i}]`);
    allFindings.push(...findings);
  }

  return Object.freeze({
    scanId,
    scanType: "telemetry" as const,
    scannedAt: new Date().toISOString(),
    totalRecordsScanned: totalScanned,
    findings: Object.freeze(allFindings),
    clean: allFindings.length === 0,
  });
}

// ─── Helpers ────────────────────────────────────────────────────────────────────

function determineSeverity(field: string): ScanSeverity {
  const criticalFields = ["private_key", "secret_key", "signing_key", "encryption_key"];
  const highFields = ["api_secret", "client_secret", "webhook_secret", "merchant_secret"];

  if (criticalFields.includes(field)) return "critical";
  if (highFields.includes(field)) return "high";
  return "medium";
}
