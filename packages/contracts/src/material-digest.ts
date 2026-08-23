/**
 * Deterministic material digest computation for commands.
 *
 * Material fields are those whose change constitutes a new command. Non-material
 * fields (commandId, issuedAt) do not affect the digest. The authority context
 * is entirely material.
 *
 * Uses RFC 8785 (JSON Canonicalization Scheme) via json-canonicalize and SHA-256
 * via Node.js crypto module.
 */

import { sha256Digest, type Sha256Digest } from "@counter/domain";
// json-canonicalize implements RFC 8785 (JSON Canonicalization Scheme), a standard
// for deterministic JSON serialization. We use it here rather than a hand-rolled
// sorted-key serializer to ensure spec-compliant handling of edge cases (Unicode
// normalization, number formatting, etc.). This aligns with the trust-protocol
// package which also uses JCS for envelope canonicalization, keeping digest
// computation consistent across the audit trail.
import { canonicalize } from "json-canonicalize";
import type { Command } from "./commands.js";

/**
 * Extracts the material fields from a command for digest computation.
 * Non-material fields (commandId, issuedAt) are excluded.
 * The authority context is included in full because changes to it
 * represent a fundamentally different authorization chain.
 */
function extractMaterialFields(command: Command): Record<string, unknown> {
  // commandId and issuedAt are non-material (they identify the command instance,
  // not the intent). Everything else is material.
  const { commandId: _commandId, issuedAt: _issuedAt, ...material } = command;
  return material as Record<string, unknown>;
}

/**
 * Serializes a value to a JSON-compatible form suitable for canonicalization.
 * Handles bigint values (from Money.amountMinor) by converting to string.
 */
function toJsonSafe(value: unknown): unknown {
  if (typeof value === "bigint") {
    return value.toString(10);
  }
  if (Array.isArray(value)) {
    return value.map(toJsonSafe);
  }
  if (value !== null && typeof value === "object") {
    const result: Record<string, unknown> = {};
    for (const [key, val] of Object.entries(value)) {
      result[key] = toJsonSafe(val);
    }
    return result;
  }
  return value;
}

/**
 * Computes the deterministic material digest of a command.
 *
 * The digest is computed as SHA-256 of the canonical JSON (RFC 8785) of the
 * material fields. Two commands with the same material fields produce the
 * same digest regardless of commandId or issuedAt.
 */
export function computeCommandMaterialDigest(command: Command): Sha256Digest {
  const material = extractMaterialFields(command);
  const jsonSafe = toJsonSafe(material);
  const canonical = canonicalize(jsonSafe);
  const bytes = new TextEncoder().encode(canonical);
  return sha256Digest(bytes);
}
