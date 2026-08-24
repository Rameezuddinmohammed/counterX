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

export type TransformFn = (rawData: unknown) => unknown;

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
  const result = transform.fn(rawData);
  return ok(result);
}

// ─── Preview Transform ────────────────────────────────────────────────────────

export function previewTransform(
  registry: TransformRegistry,
  rawData: unknown,
  transformId: string,
  version: string,
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

  const normalizedData = transform.fn(rawData);
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
    }
  }

  for (const key of normKeys) {
    if (!rawKeys.includes(key)) {
      diffs.push(`${key}: added`);
    }
  }

  return diffs;
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
 */
export function shopifyProductTransform(rawData: unknown): unknown {
  const raw = rawData as ShopifyRawProduct;

  const now = 0 as Instant;
  const sourceRef: SourceReference = {
    platform: "shopify",
    externalId: String(raw.id),
    fetchedAt: now,
    mappingVersion: { version: "1.0.0", schemaHash: "shopify-v1" },
  };

  const variants = (raw.variants ?? []).map((v) => ({
    id: String(v.id),
    productId: String(raw.id),
    merchantId: "",
    sku: v.sku ?? "",
    title: v.title ?? "Default",
    active: true,
  }));

  const product: Omit<Product, "merchantId"> & { readonly merchantId: string } = {
    id: String(raw.id),
    merchantId: "",
    title: raw.title ?? "",
    description: raw.body_html ?? "",
    variants: Object.freeze(variants),
    sourceReference: sourceRef,
    sourceReferences: Object.freeze([sourceRef]),
    status: "active",
    tombstonedAt: undefined,
    createdAt: now,
    updatedAt: now,
  };

  return Object.freeze(product);
}

// ─── Default Registry with Built-in Transforms ───────────────────────────────

export function createDefaultRegistry(): TransformRegistry {
  const registry = new TransformRegistry();
  registry.register("shopify-product", "1.0.0", shopifyProductTransform);
  return registry;
}
