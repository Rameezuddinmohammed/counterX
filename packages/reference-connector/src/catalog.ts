/**
 * Synthetic apparel catalog for the reference connector.
 *
 * Provides a fixed set of products with size/color variant combinations.
 * All prices are in INR minor units (paise).
 */

import type { ExternalReference } from "@counter/domain";
import type { IsoCurrencyCode } from "@counter/domain";

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProductVariant {
  readonly variantId: string;
  readonly productId: string;
  readonly size: string;
  readonly color: string;
  readonly sku: string;
  readonly priceMinor: bigint;
  readonly currency: IsoCurrencyCode;
  readonly inventoryQuantity: number;
}

export interface Product {
  readonly productId: string;
  readonly name: string;
  readonly description: string;
  readonly category: string;
  readonly variants: readonly ProductVariant[];
}

// ─── Constants ────────────────────────────────────────────────────────────────

const INR = "INR" as IsoCurrencyCode;

const SIZES = ["S", "M", "L", "XL"] as const;
const COLORS = ["Black", "White", "Navy"] as const;

function makeVariants(
  productId: string,
  basePrice: bigint,
  baseInventory: number,
): ProductVariant[] {
  const variants: ProductVariant[] = [];
  let index = 0;
  for (const size of SIZES) {
    for (const color of COLORS) {
      const variantId = `${productId}-${size.toLowerCase()}-${color.toLowerCase()}`;
      variants.push({
        variantId,
        productId,
        size,
        color,
        sku: `SKU-${variantId.toUpperCase()}`,
        priceMinor: basePrice + BigInt(index * 5000),
        currency: INR,
        inventoryQuantity: baseInventory + index * 2,
      });
      index++;
    }
  }
  return variants;
}

// ─── Catalog Data ─────────────────────────────────────────────────────────────

const CLASSIC_T_SHIRT: Product = {
  productId: "prod-classic-tshirt",
  name: "Classic T-Shirt",
  description: "Premium cotton crew-neck t-shirt with a relaxed fit",
  category: "tops",
  variants: makeVariants("prod-classic-tshirt", 79900n, 50),
};

const URBAN_HOODIE: Product = {
  productId: "prod-urban-hoodie",
  name: "Urban Hoodie",
  description: "Heavyweight fleece hoodie with kangaroo pocket and drawstring hood",
  category: "outerwear",
  variants: makeVariants("prod-urban-hoodie", 249900n, 30),
};

const SLIM_JEANS: Product = {
  productId: "prod-slim-jeans",
  name: "Slim Jeans",
  description: "Stretch denim slim-fit jeans with five-pocket styling",
  category: "bottoms",
  variants: makeVariants("prod-slim-jeans", 199900n, 40),
};

export const CATALOG_PRODUCTS: readonly Product[] = [CLASSIC_T_SHIRT, URBAN_HOODIE, SLIM_JEANS];

export const ALL_VARIANTS: readonly ProductVariant[] = CATALOG_PRODUCTS.flatMap((p) => p.variants);

// ─── Lookup Helpers ───────────────────────────────────────────────────────────

const productMap = new Map<string, Product>(CATALOG_PRODUCTS.map((p) => [p.productId, p]));

const variantMap = new Map<string, ProductVariant>(ALL_VARIANTS.map((v) => [v.variantId, v]));

export function getProduct(id: string): Product | undefined {
  return productMap.get(id);
}

export function getVariant(id: string): ProductVariant | undefined {
  return variantMap.get(id);
}

export function findProductsByName(query: string): readonly Product[] {
  const lower = query.toLowerCase();
  return CATALOG_PRODUCTS.filter((p) => p.name.toLowerCase().includes(lower));
}

export function findVariantsByName(query: string): readonly ProductVariant[] {
  const lower = query.toLowerCase();
  return ALL_VARIANTS.filter((v) => {
    const product = productMap.get(v.productId);
    if (!product) return false;
    return (
      product.name.toLowerCase().includes(lower) ||
      v.color.toLowerCase().includes(lower) ||
      v.size.toLowerCase().includes(lower)
    );
  });
}

export const CONNECTOR_SOURCE = "reference-connector" as const;

export function productReference(productId: string): ExternalReference {
  return { source: CONNECTOR_SOURCE, value: productId } as ExternalReference;
}

export function variantReference(variantId: string): ExternalReference {
  return { source: CONNECTOR_SOURCE, value: variantId } as ExternalReference;
}
