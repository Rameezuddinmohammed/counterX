"use client";

/**
 * Onboarding wizard Step 3: catalog review (MAPPING -> VERIFYING).
 *
 * Displays connected Shopify store status and/or any manually added items.
 * Confirming advances the application to VERIFYING for the readiness check.
 */

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, Button, Badge, Skeleton } from "@counter/ui";
import {
  ShoppingBag,
  ArrowRight,
  PackageCheck,
  CheckCircle,
  ExternalLink,
  Plus,
} from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";
import { OnboardingStepper } from "@/components/onboarding-stepper";
import { ensureStepUp, getApiClient, useWizardMerchantId } from "@/hooks/use-api";
import type { ManualCatalogItem, ShopifyConnectionStatus } from "@/lib/types";

const PERMISSIONS_NOT_READY_MESSAGE =
  "Your session isn't authorized for this merchant account. Sign out and sign back in — " +
  "merchant permissions are attached at login, so a session that started before your account " +
  "was set up won't have them until you log in again.";

export default function CatalogReviewPage() {
  const router = useRouter();
  const { merchantId, loading: merchantLoading } = useWizardMerchantId();

  const [shopifyStatus, setShopifyStatus] = useState<ShopifyConnectionStatus | null>(null);
  const [items, setItems] = useState<readonly ManualCatalogItem[]>([]);
  const [loading, setLoading] = useState(true);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [confirmError, setConfirmError] = useState<string | null>(null);

  useEffect(() => {
    if (merchantId !== undefined) {
      void loadCatalog(merchantId);
    } else if (!merchantLoading) {
      setLoading(false);
    }
  }, [merchantId, merchantLoading]);

  async function loadCatalog(id: string) {
    setLoading(true);
    const [shopifyRes, itemsRes] = await Promise.all([
      getApiClient().getShopifyConnectionStatus(id),
      getApiClient().listManualCatalogItems(id),
    ]);
    setLoading(false);

    if (shopifyRes.ok) {
      setShopifyStatus(shopifyRes.data);
    }
    if (itemsRes.ok) {
      setItems(itemsRes.data);
      setItemsError(null);
    } else {
      setItemsError(itemsRes.error.message);
    }
  }

  async function handleConfirm() {
    if (merchantId === undefined) return;

    try {
      await ensureStepUp();
    } catch {
      setConfirmError("Verification was not completed, so nothing was saved. Please try again.");
      return;
    }

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

    router.push("/invite/readiness");
  }

  if (!merchantLoading && merchantId === undefined) {
    return (
      <PageWrapper>
        <Card>
          <CardContent className="p-6 text-sm text-[var(--foreground-secondary)]">
            No application found yet.{" "}
            <Link href="/invite" className="text-[var(--brand-red)] underline">
              Start from the beginning
            </Link>
            .
          </CardContent>
        </Card>
      </PageWrapper>
    );
  }

  const isShopifyConnected = shopifyStatus?.connected === true;
  const hasItems = items.length > 0;
  const hasAnyCatalog = isShopifyConnected || hasItems;

  return (
    <PageWrapper>
      <div className="space-y-6">
        <OnboardingStepper currentStep={3} />

        <div className="border-b border-[var(--border-secondary)] pb-5">
          <p
            className="font-mono text-xs uppercase tracking-widest text-[var(--foreground-muted)] mb-2"
            data-manifest-figure
          >
            Onboarding · Step 3 of 5
          </p>
          <h1 className="font-display text-2xl font-semibold text-[var(--foreground)]">
            Review your catalog
          </h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Review the catalog sources Counter will use for AI agent discovery and orders.
          </p>
        </div>

        {loading ? (
          <Skeleton className="h-40 w-full" />
        ) : (
          <div className="space-y-5">
            {/* Shopify Store Card */}
            {isShopifyConnected ? (
              <Card>
                <CardHeader>
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-2">
                      <ShoppingBag className="h-4 w-4 text-[var(--brand-red)]" />
                      <CardTitle>Connected Shopify Store</CardTitle>
                    </div>
                    <Badge variant="success">
                      <CheckCircle className="mr-1 h-3 w-3" />
                      Sync active
                    </Badge>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  <div className="flex items-center justify-between border border-[var(--border)] p-4 bg-[var(--surface-secondary)]">
                    <div>
                      <p className="font-semibold text-[var(--foreground)] font-mono text-sm">
                        {shopifyStatus.shopDomain}
                      </p>
                      <p className="text-xs text-[var(--foreground-muted)] mt-1">
                        Connected via Admin API. Products, variants, inventory, and prices are
                        automatically synced.
                      </p>
                    </div>
                    <Link
                      href="/shopify"
                      target="_blank"
                      className="inline-flex items-center gap-1 text-xs text-[var(--brand-red)] hover:underline"
                    >
                      Shopify settings
                      <ExternalLink className="h-3 w-3" />
                    </Link>
                  </div>
                  <p className="text-xs text-[var(--foreground-muted)]">
                    AI agents will query your live Shopify inventory and place real orders when
                    purchases are approved.
                  </p>
                </CardContent>
              </Card>
            ) : null}

            {/* Manual Items Card */}
            {hasItems ? (
              <Card>
                <CardHeader>
                  <div className="flex items-center gap-2">
                    <PackageCheck className="h-4 w-4 text-[var(--brand-red)]" />
                    <CardTitle>Manual Catalog Items ({items.length})</CardTitle>
                  </div>
                </CardHeader>
                <CardContent className="space-y-3">
                  {itemsError && <p className="text-sm text-[var(--brand-red)]">{itemsError}</p>}
                  <div className="divide-y divide-[var(--border)] border border-[var(--border)]">
                    {items.map((item) => (
                      <div
                        key={item.itemId}
                        className="flex items-center justify-between px-4 py-2.5"
                      >
                        <div>
                          <p className="text-sm font-medium text-[var(--foreground)]">
                            {item.name}
                          </p>
                          {item.description && (
                            <p className="text-xs text-[var(--foreground-muted)]">
                              {item.description}
                            </p>
                          )}
                        </div>
                        <Badge variant="secondary">
                          ₹{(item.priceMinor / 100).toLocaleString("en-IN")}
                        </Badge>
                      </div>
                    ))}
                  </div>
                </CardContent>
              </Card>
            ) : null}

            {/* Empty state if neither connected */}
            {!hasAnyCatalog && (
              <Card>
                <CardContent className="p-6 text-center space-y-3">
                  <ShoppingBag className="mx-auto h-8 w-8 text-[var(--foreground-muted)]" />
                  <p className="font-medium text-[var(--foreground)]">
                    No catalog items or store connected
                  </p>
                  <p className="text-sm text-[var(--foreground-muted)] max-w-md mx-auto">
                    You need either a connected Shopify store or at least one manual product to
                    proceed with onboarding.
                  </p>
                  <Link href="/invite/catalog-connect">
                    <Button variant="outline" size="sm">
                      <Plus className="mr-1.5 h-3.5 w-3.5" />
                      Connect catalog now
                    </Button>
                  </Link>
                </CardContent>
              </Card>
            )}

            <p className="text-xs text-[var(--foreground-muted)]">
              Confirming moves your application to the readiness verification phase. You can still
              adjust your catalog anytime later.
            </p>

            {confirmError && <p className="text-sm text-[var(--brand-red)]">{confirmError}</p>}

            <div className="flex items-center justify-between pt-2">
              <Button onClick={() => void handleConfirm()} disabled={confirming || !hasAnyCatalog}>
                {confirming ? "Confirming…" : "Confirm and continue"}
                <ArrowRight className="ml-2 h-3.5 w-3.5" />
              </Button>

              <Link
                href="/invite/catalog-connect"
                className="text-xs text-[var(--foreground-muted)] hover:underline"
              >
                Back to edit catalog sources
              </Link>
            </div>
          </div>
        )}
      </div>
    </PageWrapper>
  );
}
