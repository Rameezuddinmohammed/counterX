"use client";

/**
 * Onboarding wizard Step 2: catalog connect.
 *
 * Offers two real paths:
 *   - Connect Shopify directly within the wizard:
 *       * One-click OAuth when an OAuth app is configured
 *       * Admin API access token (always available) with real-time verification
 *     Once connected, the store is verified, products begin backfilling, and
 *     the application auto-advances CONNECTING -> MAPPING.
 *   - Manual catalog entry: simple form persisted to manual_catalog_items.
 */

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Button,
  Input,
  Badge,
  Skeleton,
} from "@counter/ui";
import {
  ShoppingBag,
  Plus,
  ArrowRight,
  CheckCircle,
  KeyRound,
  ExternalLink,
  RotateCcw,
} from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";
import { OnboardingStepper } from "@/components/onboarding-stepper";
import { ensureStepUp, getApiClient, useWizardMerchantId } from "@/hooks/use-api";
import type { ManualCatalogItem, ShopifyConnectionStatus } from "@/lib/types";

const CONTROL_PLANE_BASE_URL =
  process.env["NEXT_PUBLIC_API_BASE_URL"] ?? "https://counter-control-plane-api.fly.dev/control/v1";

const SHOP_DOMAIN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

const PERMISSIONS_NOT_READY_MESSAGE =
  "Your session isn't authorized for this merchant account. Sign out and sign back in — " +
  "merchant permissions are attached at login, so a session that started before your account " +
  "was set up won't have them until you log in again.";

function shopifyAuthorizeUrl(merchantId: string, shopDomain: string): string {
  const url = new URL(
    `${CONTROL_PLANE_BASE_URL}/merchants/${encodeURIComponent(merchantId)}/shopify/authorize`,
  );
  url.searchParams.set("shop", shopDomain);
  return url.toString();
}

export default function CatalogConnectPage() {
  const router = useRouter();
  const { merchantId, loading: merchantLoading } = useWizardMerchantId();

  const [shopifyStatus, setShopifyStatus] = useState<ShopifyConnectionStatus | null>(null);
  const [shopifyLoading, setShopifyLoading] = useState(true);
  const [shopDomain, setShopDomain] = useState("");
  const [accessToken, setAccessToken] = useState("");
  const [connectingShopify, setConnectingShopify] = useState(false);
  const [shopifyError, setShopifyError] = useState<string | null>(null);
  const [showShopifyForm, setShowShopifyForm] = useState(false);

  const [items, setItems] = useState<readonly ManualCatalogItem[]>([]);
  const [itemsError, setItemsError] = useState<string | null>(null);
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [price, setPrice] = useState("");
  const [addingItem, setAddingItem] = useState(false);
  const [addItemError, setAddItemError] = useState<string | null>(null);

  const [finishing, setFinishing] = useState(false);
  const [finishError, setFinishError] = useState<string | null>(null);
  const [callbackNotice, setCallbackNotice] = useState<"connected" | "error" | null>(null);

  useEffect(() => {
    if (merchantId !== undefined) {
      void loadData(merchantId);
    } else if (!merchantLoading) {
      setShopifyLoading(false);
    }
  }, [merchantId, merchantLoading]);

  // Handle redirect back from OAuth (?shopify=connected|error)
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("shopify");
    if (outcome === "connected" || outcome === "error") {
      setCallbackNotice(outcome);
      window.history.replaceState(null, "", window.location.pathname);
      if (outcome === "connected" && merchantId !== undefined) {
        void handlePostOAuthConnected(merchantId);
      }
    }
  }, [merchantId]);

  async function loadData(id: string) {
    setShopifyLoading(true);
    const [shopifyRes, itemsRes] = await Promise.all([
      getApiClient().getShopifyConnectionStatus(id),
      getApiClient().listManualCatalogItems(id),
    ]);
    setShopifyLoading(false);

    if (shopifyRes.ok) {
      setShopifyStatus(shopifyRes.data);
      if (shopifyRes.data.connected && shopifyRes.data.shopDomain) {
        setShopDomain(shopifyRes.data.shopDomain);
      }
    }
    if (itemsRes.ok) {
      setItems(itemsRes.data);
      setItemsError(null);
    } else {
      setItemsError(itemsRes.error.message);
    }
  }

  async function handlePostOAuthConnected(id: string) {
    // Auto-advance application to MAPPING
    await getApiClient().markCatalogConnected(id);
    await loadData(id);
  }

  function validatedShopDomain(): string | null {
    const trimmed = shopDomain.trim().toLowerCase();
    if (!SHOP_DOMAIN_PATTERN.test(trimmed)) {
      setShopifyError(
        "Enter your store's .myshopify.com address, e.g. my-store.myshopify.com — not your custom domain.",
      );
      return null;
    }
    return trimmed;
  }

  function handleOAuthConnect() {
    setShopifyError(null);
    if (!merchantId) {
      setShopifyError("Still determining your merchant account — try again in a moment.");
      return;
    }
    const trimmed = validatedShopDomain();
    if (trimmed === null) return;
    window.location.href = shopifyAuthorizeUrl(merchantId, trimmed);
  }

  async function handleTokenConnect() {
    setShopifyError(null);
    if (!merchantId) {
      setShopifyError("Still determining your merchant account — try again in a moment.");
      return;
    }
    const trimmed = validatedShopDomain();
    if (trimmed === null) return;
    if (accessToken.trim().length === 0) {
      setShopifyError("Paste the Admin API access token from your custom app.");
      return;
    }

    try {
      await ensureStepUp();
    } catch {
      setShopifyError("Verification was not completed, so the store was not connected.");
      return;
    }

    setConnectingShopify(true);
    const result = await getApiClient().connectShopifyWithToken(merchantId, {
      shopDomain: trimmed,
      accessToken: accessToken.trim(),
    });

    if (!result.ok) {
      setConnectingShopify(false);
      setShopifyError(result.error.message);
      return;
    }

    // Auto-advance the application to MAPPING
    await getApiClient().markCatalogConnected(merchantId);
    setConnectingShopify(false);
    setAccessToken("");
    setCallbackNotice("connected");
    setShowShopifyForm(false);
    await loadData(merchantId);

    // Automatically navigate to review
    router.push("/invite/catalog-review");
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

    try {
      await ensureStepUp();
    } catch {
      setAddItemError("Verification was not completed, so nothing was saved. Please try again.");
      return;
    }

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
    if (merchantId !== undefined) {
      const itemsRes = await getApiClient().listManualCatalogItems(merchantId);
      if (itemsRes.ok) setItems(itemsRes.data);
    }
  }

  async function handleFinish() {
    if (merchantId === undefined) return;

    try {
      await ensureStepUp();
    } catch {
      setFinishError("Verification was not completed, so nothing was saved. Please try again.");
      return;
    }

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
    router.push("/invite/catalog-review");
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

  const isConnected = shopifyStatus?.connected === true;
  const oauthAvailable = shopifyStatus?.oauthAvailable === true;
  const hasCatalogSource = isConnected || items.length > 0;

  return (
    <PageWrapper>
      <div className="space-y-6">
        <OnboardingStepper currentStep={2} />

        <div className="border-b border-[var(--border-secondary)] pb-5">
          <p
            className="font-mono text-xs uppercase tracking-widest text-[var(--foreground-muted)] mb-2"
            data-manifest-figure
          >
            Onboarding · Step 2 of 5
          </p>
          <h1 className="font-display text-2xl font-semibold text-[var(--foreground)]">
            Connect your catalog
          </h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Connect Shopify to import your store&apos;s products, or enter items manually.
          </p>
        </div>

        {callbackNotice === "connected" && (
          <div className="border border-[var(--clearance-teal)]/30 bg-[var(--clearance-teal)]/10 px-4 py-3 text-sm text-[var(--clearance-teal)] flex items-center justify-between">
            <span>Shopify store connected! Your products are being imported now.</span>
            <Button size="sm" onClick={() => router.push("/invite/catalog-review")}>
              Continue to Review
              <ArrowRight className="ml-1.5 h-3.5 w-3.5" />
            </Button>
          </div>
        )}

        {callbackNotice === "error" && (
          <div className="border border-[var(--brand-red)]/30 bg-[var(--brand-red)]/10 px-4 py-3 text-sm text-[var(--brand-red)]">
            Shopify did not complete the connection. Please try again below.
          </div>
        )}

        {/* Option A: Shopify Connect */}
        <Card>
          <CardHeader>
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <ShoppingBag className="h-4 w-4 text-[var(--brand-red)]" />
                <CardTitle>Option A: Connect Shopify</CardTitle>
              </div>
              {isConnected && !showShopifyForm && (
                <Badge variant="success">
                  <CheckCircle className="mr-1 h-3 w-3" />
                  Connected
                </Badge>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            {shopifyLoading ? (
              <Skeleton className="h-20 w-full" />
            ) : isConnected && !showShopifyForm ? (
              <div className="space-y-4">
                <div className="flex items-center justify-between border border-[var(--border)] p-4 bg-[var(--surface-secondary)]">
                  <div>
                    <p className="font-semibold text-[var(--foreground)] font-mono">
                      {shopifyStatus.shopDomain}
                    </p>
                    <p className="text-xs text-[var(--foreground-muted)] mt-1">
                      Connected{" "}
                      {shopifyStatus.connectedAt
                        ? `on ${new Date(shopifyStatus.connectedAt).toLocaleDateString()}`
                        : "successfully"}
                      . Catalog sync is active.
                    </p>
                  </div>
                  <Button variant="outline" size="sm" onClick={() => setShowShopifyForm(true)}>
                    <RotateCcw className="mr-1.5 h-3.5 w-3.5" />
                    Reconnect or change
                  </Button>
                </div>

                <Button onClick={() => void handleFinish()} disabled={finishing}>
                  {finishing ? "Checking…" : "Continue with this store"}
                  <ArrowRight className="ml-2 h-3.5 w-3.5" />
                </Button>
              </div>
            ) : (
              <div className="space-y-4">
                <p className="text-sm text-[var(--foreground-secondary)]">
                  Import your Shopify products so AI agents can query and purchase them.
                </p>

                <div className="space-y-2">
                  <label
                    className="text-sm font-medium text-[var(--foreground)]"
                    htmlFor="wizard-shop-domain"
                  >
                    Shopify store address
                  </label>
                  <Input
                    id="wizard-shop-domain"
                    value={shopDomain}
                    onChange={(event) => setShopDomain(event.target.value)}
                    placeholder="my-store.myshopify.com"
                    className="sm:max-w-md"
                  />
                  <p className="text-xs text-[var(--foreground-muted)]">
                    Use your .myshopify.com address, not a custom domain.
                  </p>
                </div>

                {oauthAvailable && (
                  <div className="border-t border-[var(--border-secondary)] pt-4">
                    <p className="text-sm text-[var(--foreground-secondary)] mb-3">
                      Authorize directly in Shopify with one click.
                    </p>
                    <Button onClick={handleOAuthConnect}>
                      <ShoppingBag className="mr-2 h-3.5 w-3.5" />
                      Connect with Shopify
                    </Button>
                  </div>
                )}

                <div className="border-t border-[var(--border-secondary)] pt-4 space-y-3">
                  <div>
                    <p className="text-sm font-medium text-[var(--foreground)]">
                      {oauthAvailable
                        ? "Or connect with an Admin API access token"
                        : "Admin API access token"}
                    </p>
                    <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
                      In your Shopify admin:{" "}
                      <span className="font-mono text-xs">
                        Settings → Apps and sales channels → Develop apps
                      </span>
                      , create an app with scopes{" "}
                      <span className="font-mono text-xs">read_products</span>,{" "}
                      <span className="font-mono text-xs">read_orders</span>, and{" "}
                      <span className="font-mono text-xs">write_orders</span>, install it, and paste
                      the token below.
                    </p>
                    <a
                      href="https://help.shopify.com/en/manual/apps/app-types/custom-apps"
                      target="_blank"
                      rel="noreferrer"
                      className="mt-1.5 inline-flex items-center gap-1 text-xs text-[var(--brand-red)] underline"
                    >
                      Shopify custom app instructions
                      <ExternalLink className="h-3 w-3" />
                    </a>
                  </div>

                  <div className="flex flex-col gap-2 sm:flex-row">
                    <Input
                      value={accessToken}
                      onChange={(event) => setAccessToken(event.target.value)}
                      placeholder="shpat_..."
                      type="password"
                      autoComplete="off"
                      className="sm:max-w-md font-mono"
                    />
                    <Button onClick={() => void handleTokenConnect()} disabled={connectingShopify}>
                      <KeyRound className="mr-2 h-3.5 w-3.5" />
                      {connectingShopify ? "Verifying with Shopify…" : "Connect store"}
                    </Button>
                  </div>

                  {isConnected && showShopifyForm && (
                    <Button
                      variant="outline"
                      size="sm"
                      onClick={() => setShowShopifyForm(false)}
                      className="mt-2"
                    >
                      Cancel and keep current store
                    </Button>
                  )}
                </div>

                {shopifyError && <p className="text-sm text-[var(--brand-red)]">{shopifyError}</p>}
              </div>
            )}
          </CardContent>
        </Card>

        {/* Option B: Manual Items */}
        <Card>
          <CardHeader>
            <CardTitle>Option B: Add items manually</CardTitle>
          </CardHeader>
          <CardContent className="space-y-5">
            <p className="text-sm text-[var(--foreground-secondary)]">
              Testing without Shopify? You can enter a few products manually.
            </p>

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
              {addItemError && <p className="text-sm text-[var(--brand-red)]">{addItemError}</p>}
              <Button type="submit" variant="outline" disabled={addingItem}>
                <Plus className="mr-2 h-3.5 w-3.5" />
                {addingItem ? "Adding…" : "Add item"}
              </Button>
            </form>

            {itemsError && <p className="text-sm text-[var(--brand-red)]">{itemsError}</p>}
            {items.length > 0 && (
              <div className="divide-y divide-[var(--border)] border border-[var(--border)]">
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

        {finishError && <p className="text-sm text-[var(--brand-red)]">{finishError}</p>}

        <div className="flex items-center justify-between pt-2">
          <Button onClick={() => void handleFinish()} disabled={finishing || !hasCatalogSource}>
            {finishing ? "Checking…" : "Continue to review catalog"}
            <ArrowRight className="ml-2 h-3.5 w-3.5" />
          </Button>

          {!hasCatalogSource && (
            <p className="text-xs text-[var(--foreground-muted)]">
              Connect a Shopify store or add at least one item to continue.
            </p>
          )}
        </div>
      </div>
    </PageWrapper>
  );
}
