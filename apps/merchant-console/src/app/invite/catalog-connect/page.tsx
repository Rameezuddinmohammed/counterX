"use client";

/**
 * Onboarding wizard Step 2: catalog connect. Two real paths:
 *   - "Connect Shopify" — links to the ALREADY-BUILT /shopify OAuth flow
 *     (apps/merchant-console/src/app/shopify/page.tsx), per this task's
 *     scope: reuse it as-is, don't rebuild it. KNOWN LIMITATION: that page
 *     operates on a single hardcoded NEXT_PUBLIC_MERCHANT_ID (see its own
 *     source), not this wizard's freshly-provisioned merchantId — so
 *     completing Shopify OAuth there only counts as "this application's
 *     catalog is connected" when the two happen to be the same merchant.
 *     Generalizing /shopify to accept an arbitrary merchantId is real
 *     follow-up work, out of scope here (this task was told not to modify
 *     that file). The manual-entry path below works correctly for ANY
 *     freshly-provisioned merchant regardless of this gap.
 *   - Manual catalog entry — a simple repeating form (name, description,
 *     price, currency), persisted to the new merchant.manual_catalog_items
 *     table. Schema.org/AI-driven extraction is explicitly deferred.
 *
 * Either path (at least one manual item, OR an active Shopify connection
 * for this exact merchantId) is sufficient for POST .../catalog-connected
 * to transition CONNECTING -> MAPPING — see
 * merchant-application-store.ts's markCatalogConnected, which re-verifies
 * server-side rather than trusting the client's claim.
 */

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Badge } from "@counter/ui";
import { ShoppingBag, Plus, ArrowRight } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";
import { getApiClient } from "@/hooks/use-api";
import { getStoredMerchantId } from "@/lib/merchant-application-storage";
import type { ManualCatalogItem } from "@/lib/types";

const PERMISSIONS_NOT_READY_MESSAGE =
  "Your session doesn't have merchant permissions yet. This step needs a one-time Auth0 " +
  "configuration change on Counter's side (not yet done) before it can save — this is a known, " +
  "tracked gap, not something wrong with what you entered.";

export default function CatalogConnectPage() {
  const router = useRouter();
  const [merchantId, setMerchantId] = useState<string | undefined>(undefined);
  const [checkedStorage, setCheckedStorage] = useState(false);
  const [items, setItems] = useState<readonly ManualCatalogItem[]>([]);
  const [itemsError, setItemsError] = useState<string | null>(null);

  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [addingItem, setAddingItem] = useState(false);
  const [addItemError, setAddItemError] = useState<string | null>(null);

  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);

  useEffect(() => {
    const id = getStoredMerchantId();
    setMerchantId(id);
    setCheckedStorage(true);
    if (id !== undefined) {
      void loadItems(id);
    }
  }, []);

  async function loadItems(id: string) {
    const result = await getApiClient().listManualCatalogItems(id);
    if (result.ok) {
      setItems(result.data);
      setItemsError(null);
    } else {
      setItemsError(result.error.message);
    }
  }

  async function handleAddItem(event: FormEvent) {
    event.preventDefault();
    setAddItemError(null);
    if (merchantId === undefined) return;

    if (name.trim().length === 0) {
      setAddItemError("Item name is required.");
      return;
    }
    const rupees = Number(price);
    if (!Number.isFinite(rupees) || rupees < 0) {
      setAddItemError("Enter a valid price in rupees.");
      return;
    }
    const priceMinor = Math.round(rupees * 100);

    setAddingItem(true);
    const result = await getApiClient().addManualCatalogItem(merchantId, {
      name: name.trim(),
      ...(description.trim().length > 0 ? { description: description.trim() } : {}),
      priceMinor,
      currency: "INR",
    });
    setAddingItem(false);

    if (!result.ok) {
      setAddItemError(
        result.error.code === "UNAUTHORIZED" || result.error.code === "FORBIDDEN"
          ? PERMISSIONS_NOT_READY_MESSAGE
          : result.error.message,
      );
      return;
    }
    setName("");
    setDescription("");
    setPrice("");
    await loadItems(merchantId);
  }

  async function handleFinish() {
    if (merchantId === undefined) return;
    setFinishing(true);
    setFinishError(null);
    const result = await getApiClient().markCatalogConnected(merchantId);
    setFinishing(false);

    if (!result.ok) {
      setFinishError(
        result.error.code === "UNAUTHORIZED" || result.error.code === "FORBIDDEN"
          ? PERMISSIONS_NOT_READY_MESSAGE
          : result.error.message,
      );
      return;
    }
    router.push("/invite");
  }

  if (checkedStorage && merchantId === undefined) {
    return (
      <PageWrapper>
        <Card>
          <CardContent className="p-6 text-sm text-[var(--foreground-secondary)]">
            No application found yet.{" "}
            <Link href="/invite" className="text-[var(--brand-orange)] underline">
              Start from the beginning
            </Link>
            .
          </CardContent>
        </Card>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Connect your catalog</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Connect Shopify, or add a few items manually to get started.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>Option A: Connect Shopify</CardTitle>
          </CardHeader>
          <CardContent>
            <p className="mb-4 text-sm text-[var(--foreground-secondary)]">
              Import your store's products automatically.
            </p>
            <Link href="/shopify">
              <Button variant="outline">
                <ShoppingBag className="mr-2 h-3.5 w-3.5" />
                Connect Shopify
              </Button>
            </Link>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Option B: Add items manually</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <form className="space-y-3" onSubmit={(event) => void handleAddItem(event)}>
              <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
                <Input
                  value={name}
                  onChange={(event) => setName(event.target.value)}
                  placeholder="Item name"
                />
                <Input
                  value={price}
                  onChange={(event) => setPrice(event.target.value)}
                  placeholder="Price (INR)"
                  inputMode="decimal"
                />
              </div>
              <Input
                value={description}
                onChange={(event) => setDescription(event.target.value)}
                placeholder="Description (optional)"
              />
              {addItemError && <p className="text-sm text-red-600">{addItemError}</p>}
              <Button type="submit" variant="outline" disabled={addingItem}>
                <Plus className="mr-2 h-3.5 w-3.5" />
                {addingItem ? "Adding…" : "Add item"}
              </Button>
            </form>

            {itemsError && <p className="text-sm text-red-600">{itemsError}</p>}
            {items.length > 0 && (
              <div className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
                {items.map((item) => (
                  <div key={item.itemId} className="flex items-center justify-between px-4 py-2.5">
                    <div>
                      <p className="text-sm font-medium text-[var(--foreground)]">{item.name}</p>
                      {item.description && (
                        <p className="text-xs text-[var(--foreground-muted)]">{item.description}</p>
                      )}
                    </div>
                    <Badge variant="secondary">
                      ₹{(item.priceMinor / 100).toLocaleString("en-IN")}
                    </Badge>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        {finishError && <p className="text-sm text-red-600">{finishError}</p>}
        <Button onClick={() => void handleFinish()} disabled={finishing}>
          {finishing ? "Checking…" : "Continue"}
          <ArrowRight className="ml-2 h-3.5 w-3.5" />
        </Button>
      </div>
    </PageWrapper>
  );
}
