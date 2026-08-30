"use client";

/**
 * Onboarding wizard Step 3: catalog review (MAPPING -> VERIFYING).
 *
 * JUDGMENT CALL, disclosed (see merchant-application-store.ts's
 * confirmCatalog docs for the backend side of this): there is no real
 * Shopify product-fetch/sync pipeline yet — shopify-connection-store.ts
 * only stores the OAuth token, it never calls Shopify's product API. So a
 * Shopify-connected merchant has no real per-item product data to review
 * here; this page shows that connection as already sufficient rather than
 * rendering a fake per-item review list. Manual items, which the merchant
 * typed themselves, are bulk-confirmed with a single "Confirm and
 * continue" — no AI extraction was involved, so there is no mandatory
 * per-item AI-review gate to satisfy (that only matters once AI-driven
 * extraction exists, which it doesn't yet).
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, Button, Badge } from "@counter/ui";
import { ShoppingBag, ArrowRight, PackageCheck } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";
import { getApiClient } from "@/hooks/use-api";
import { getStoredMerchantId } from "@/lib/merchant-application-storage";
import type { ManualCatalogItem } from "@/lib/types";

const PERMISSIONS_NOT_READY_MESSAGE =
  "Your session doesn't have merchant permissions yet. This step needs a one-time Auth0 " +
  "configuration change on Counter's side (not yet done) before it can save — this is a known, " +
  "tracked gap, not something wrong with what you entered.";

export default function CatalogReviewPage() {
  const router = useRouter();
  const [merchantId, setMerchantId] = useState<string | undefined>(undefined);
  const [checkedStorage, setCheckedStorage] = useState(false);
  const [items, setItems] = useState<readonly ManualCatalogItem[]>([]);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

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

  async function handleConfirm() {
    if (merchantId === undefined) return;
    setConfirming(true);
    setConfirmError(null);
    const result = await getApiClient().confirmCatalog(merchantId);
    setConfirming(false);

    if (!result.ok) {
      setConfirmError(
        result.error.code === "UNAUTHORIZED" || result.error.code === "FORBIDDEN"
          ? PERMISSIONS_NOT_READY_MESSAGE
          : result.error.message,
      );
      return;
    }
    router.push("/invite/payment-connect");
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
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Review your catalog</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Take one last look before we start verifying your setup.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              <div className="flex items-center gap-2">
                <PackageCheck className="h-4 w-4 text-[var(--brand-orange)]" />
                What we have on file
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {itemsError && <p className="text-sm text-red-600">{itemsError}</p>}
            {items.length > 0 ? (
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
            ) : (
              <p className="flex items-center gap-2 text-sm text-[var(--foreground-secondary)]">
                <ShoppingBag className="h-4 w-4" />
                No manually-added items — if you connected Shopify instead, that's fine, it's
                treated as sufficient on its own for now.
              </p>
            )}
            <p className="text-xs text-[var(--foreground-muted)]">
              Confirming does not lock these in forever — you can still adjust your catalog later.
            </p>
          </CardContent>
        </Card>

        {confirmError && <p className="text-sm text-red-600">{confirmError}</p>}
        <Button onClick={() => void handleConfirm()} disabled={confirming}>
          {confirming ? "Confirming…" : "Confirm and continue"}
          <ArrowRight className="ml-2 h-3.5 w-3.5" />
        </Button>
      </div>
    </PageWrapper>
  );
}
