/**
 * Deterministic transform engine for the commerce graph.
 *
 * Transforms are pure functions: same input always produces same output.
 * No side effects, no randomness, no external state.
 */

import type { Instant, Result } from "@counter/domain";
import { createCanonicalError, err, ok } from "@counter/domain";
import type { Product, RawNormalizedPreview, SourceReference } from "./index.js";

// ─── Transform Function Type ──────────────────────────────────────────────────

export type TransformFn = (rawData: unknown, context?: TransformContext) => unknown;

/** Context parameters for transforms that need runtime information. */
export interface TransformContext {
  readonly merchantId: string;
  readonly fetchedAt: Instant;
}

// ─── Transform Registry ───────────────────────────────────────────────────────

interface RegisteredTransform {
  readonly id: string;
  readonly version: string;
  readonly fn: TransformFn;
}

export class TransformRegistry {
  readonly #transforms = new Map<string, RegisteredTransform>();

  static #key(id: string, version: string): string {
    return `${id}@${version}`;
  }

  public register(id: string, version: string, fn: TransformFn): void {
    const key = TransformRegistry.#key(id, version);
    this.#transforms.set(key, Object.freeze({ id, version, fn }));
  }

  public get(id: string, version: string): RegisteredTransform | undefined {
    return this.#transforms.get(TransformRegistry.#key(id, version));
  }

  public has(id: string, version: string): boolean {
    return this.#transforms.has(TransformRegistry.#key(id, version));
  }
}

// ─── Apply Transform ──────────────────────────────────────────────────────────

export function applyTransform(
  registry: TransformRegistry,
  rawData: unknown,
  transformId: string,
  version: string,
  context?: TransformContext,
): Result<unknown> {
  const transform = registry.get(transformId, version);
  if (transform === undefined) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "UNSUPPORTED_VALUE",
        message: "Transform not found in registry",
      }),
    );
  }
  const result = transform.fn(rawData, context);
  return ok(result);
}

// ─── Preview Transform ────────────────────────────────────────────────────────

export function previewTransform(
  registry: TransformRegistry,
  rawData: unknown,
  transformId: string,
  version: string,
  context?: TransformContext,
): Result<RawNormalizedPreview> {
  const transform = registry.get(transformId, version);
  if (transform === undefined) {
    return err(
      createCanonicalError({
        category: "validation",
        code: "UNSUPPORTED_VALUE",
        message: "Transform not found in registry",
      }),
    );
  }

  const normalizedData = transform.fn(rawData, context);
  const differences = computeDifferences(rawData, normalizedData);

  return ok(
    Object.freeze({
      rawData,
      normalizedData,
      transformId,
      transformVersion: version,
      differences: Object.freeze(differences),
    }),
  );
}

// ─── Difference Computation ───────────────────────────────────────────────────

function computeDifferences(raw: unknown, normalized: unknown): string[] {
  const diffs: string[] = [];
  if (raw === null || raw === undefined || typeof raw !== "object") {
    if (raw !== normalized) {
      diffs.push("root: value changed");
    }
    return diffs;
  }
  if (normalized === null || normalized === undefined || typeof normalized !== "object") {
    diffs.push("root: type changed");
    return diffs;
  }

  const rawObj = raw as Record<string, unknown>;
  const normObj = normalized as Record<string, unknown>;

  const rawKeys = Object.keys(rawObj);
  const normKeys = new Set(Object.keys(normObj));

  for (const key of rawKeys) {
    if (!normKeys.has(key)) {
      diffs.push(`${key}: removed`);
    } else {
      // Key exists in both - check for value changes
      const rawVal = rawObj[key];
      const normVal = normObj[key];
      if (!deepEqual(rawVal, normVal)) {
        diffs.push(`${key}: changed`);
      }
    }
  }

  for (const key of normKeys) {
    if (!rawKeys.includes(key)) {
      diffs.push(`${key}: added`);
    }
  }

  return diffs;
}

/**
 * Deep equality check for comparing raw and normalized values.
 */
function deepEqual(a: unknown, b: unknown): boolean {
  if (a === b) return true;
  if (a === null || b === null) return false;
  if (a === undefined || b === undefined) return false;
  if (typeof a !== typeof b) return false;
  if (typeof a !== "object") return false;

  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
      if (!deepEqual(a[i], b[i])) return false;
    }
    return true;
  }
  if (Array.isArray(a) || Array.isArray(b)) return false;

  const aObj = a as Record<string, unknown>;
  const bObj = b as Record<string, unknown>;
  const aKeys = Object.keys(aObj);
  const bKeys = Object.keys(bObj);

  if (aKeys.length !== bKeys.length) return false;

  for (const key of aKeys) {
    if (!Object.prototype.hasOwnProperty.call(bObj, key)) return false;
    if (!deepEqual(aObj[key], bObj[key])) return false;
  }

  return true;
}

// ─── Built-in Shopify Product Transform ───────────────────────────────────────

interface ShopifyRawProduct {
  readonly id: string | number;
  readonly title: string;
  readonly body_html?: string;
  readonly vendor?: string;
  readonly product_type?: string;
  readonly handle?: string;
  readonly variants?: readonly ShopifyRawVariant[];
}

interface ShopifyRawVariant {
  readonly id: string | number;
  readonly title?: string;
  readonly sku?: string;
  readonly price?: string;
}

/**
 * Transforms a raw Shopify-like product JSON into the normalized Product type.
 * This is a pure, deterministic function.
 *
 * When no context is provided, uses placeholder values (fetchedAt: 0, merchantId: "").
 * For production usage, always supply a TransformContext with the actual merchantId
 * and fetchedAt values.
 */
export function shopifyProductTransform(rawData: unknown, context?: TransformContext): unknown {
  const raw = rawData as ShopifyRawProduct;

  const fetchedAt = context?.fetchedAt ?? (0 as Instant);
  const merchantId = context?.merchantId ?? "";

  const sourceRef: SourceReference = {
    platform: "shopify",
    externalId: String(raw.id),
    fetchedAt,
    mappingVersion: { version: "1.0.0", schemaHash: "shopify-v1" },
  };

  const variants = (raw.variants ?? []).map((v) => ({
    id: String(v.id),
    productId: String(raw.id),
    merchantId,
    sku: v.sku ?? "",
    title: v.title ?? "Default",
    active: true,
  }));

  const product: Omit<Product, "merchantId"> & { readonly merchantId: string } = {
    id: String(raw.id),
    merchantId,
    title: raw.title ?? "",
    description: raw.body_html ?? "",
    variants: Object.freeze(variants),
    sourceReference: sourceRef,
    sourceReferences: Object.freeze([sourceRef]),
    status: "active",
    tombstonedAt: undefined,
    createdAt: fetchedAt,
    updatedAt: fetchedAt,
  };

  return Object.freeze(product);
}

// ─── Default Registry with Built-in Transforms ───────────────────────────────

export function createDefaultRegistry(): TransformRegistry {
  const registry = new TransformRegistry();
  registry.register("shopify-product", "1.0.0", shopifyProductTransform);
  return registry;
}
