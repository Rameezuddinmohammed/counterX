/**
 * In-memory product index that maintains only released products.
 *
 * Exposes safe agent projections that never leak internal IDs or
 * raw source references.
 */

import type { Product, Variant } from "@counter/commerce-graph";

// ─── Safe Agent Projections ───────────────────────────────────────────────────

export interface VariantProjection {
  readonly id: string;
  readonly productId: string;
  readonly sku: string;
  readonly title: string;
  readonly active: boolean;
}

export interface ProductProjection {
  readonly id: string;
  readonly title: string;
  readonly description: string;
  readonly variants: readonly VariantProjection[];
  readonly status: "released";
  readonly source: string;
}

// ─── Product Index ────────────────────────────────────────────────────────────

export class ProductIndex {
  readonly #products = new Map<string, ProductProjection>();
  readonly #variants = new Map<string, VariantProjection>();

  /**
   * Indexes products, keeping only those with status 'released'.
   * Non-released products are removed from the index if previously indexed.
   */
  public indexProducts(products: readonly Product[]): void {
    for (const product of products) {
      if (product.status === "released") {
        const variantProjections: VariantProjection[] = product.variants.map((v: Variant) =>
          Object.freeze({
            id: v.id,
            productId: v.productId,
            sku: v.sku,
            title: v.title,
            active: v.active,
          }),
        );

        const projection: ProductProjection = Object.freeze({
          id: product.id,
          title: product.title,
          description: product.description,
          variants: Object.freeze(variantProjections),
          status: "released" as const,
          source: product.sourceReference.platform,
        });

        this.#products.set(product.id, projection);
        for (const vp of variantProjections) {
          this.#variants.set(vp.id, vp);
        }
      } else {
        // Remove from index if product is no longer released
        const existing = this.#products.get(product.id);
        if (existing) {
          for (const v of existing.variants) {
            this.#variants.delete(v.id);
          }
          this.#products.delete(product.id);
        }
      }
    }
  }

  /**
   * Text search across title, description, and SKU.
   * Returns safe agent projections (no internal IDs leaked).
   */
  public search(query: string, limit?: number): readonly ProductProjection[] {
    const normalizedQuery = query.toLowerCase();
    const results: ProductProjection[] = [];
    const maxResults = limit ?? 50;

    for (const product of this.#products.values()) {
      if (results.length >= maxResults) break;

      const titleMatch = product.title.toLowerCase().includes(normalizedQuery);
      const descMatch = product.description.toLowerCase().includes(normalizedQuery);
      const skuMatch = product.variants.some((v) => v.sku.toLowerCase().includes(normalizedQuery));

      if (titleMatch || descMatch || skuMatch) {
        results.push(product);
      }
    }

    return Object.freeze(results);
  }

  /**
   * Get a single product projection by ID.
   */
  public getProduct(productId: string): ProductProjection | null {
    return this.#products.get(productId) ?? null;
  }

  /**
   * Get a single variant projection by ID.
   */
  public getVariant(variantId: string): VariantProjection | null {
    return this.#variants.get(variantId) ?? null;
  }
}
