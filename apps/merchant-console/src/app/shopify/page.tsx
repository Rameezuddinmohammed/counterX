"use client";

/**
 * Real self-serve Shopify connect: this page shows the REAL connection
 * status from control-plane-api's shopify_connections table (GET
 * /control/v1/merchants/:merchantId/shopify/connection) and, when not
 * connected, a "Connect Shopify" button that navigates the browser to the
 * REAL authorization-code-grant start (GET
 * /control/v1/merchants/:merchantId/shopify/authorize), which redirects to
 * Shopify's own consent screen. See
 * apps/control-plane-api/src/shopify-connect-routes.ts for the full flow.
 *
 * Deliberately minimal, per this task's scope: no product/order counts, no
 * webhook management, no sync — those belong to the separate, later
 * merchant-console UI work.
 *
 * merchantId is the real, signed-in merchant's id (useCurrentMerchantId,
 * decoded from the access token control-plane-api already verifies on
 * every request) — not a hardcoded placeholder.
 */

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Badge,
  Button,
  Input,
  Skeleton,
  ErrorState,
} from "@counter/ui";
import { ShoppingBag, CheckCircle } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";
import { useApi, useCurrentMerchantId } from "@/hooks/use-api";
import type { ShopifyConnectionStatus } from "@/lib/types";

const CONTROL_PLANE_BASE_URL =
  process.env["NEXT_PUBLIC_API_BASE_URL"] ?? "https://counter-control-plane-api.fly.dev/control/v1";

const SHOP_DOMAIN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

function shopifyAuthorizeUrl(merchantId: string, shopDomain: string): string {
  const url = new URL(
    `${CONTROL_PLANE_BASE_URL}/merchants/${encodeURIComponent(merchantId)}/shopify/authorize`,
  );
  url.searchParams.set("shop", shopDomain);
  return url.toString();
}

export default function ShopifyPage() {
  const { merchantId, loading: merchantLoading, error: merchantError } = useCurrentMerchantId();
  const {
    data,
    loading: connectionLoading,
    error: connectionError,
    refetch,
  } = useApi(
    (client) =>
      merchantId
        ? client.getShopifyConnectionStatus(merchantId)
        : Promise.resolve({
            ok: true as const,
            data: { connected: false } satisfies ShopifyConnectionStatus,
          }),
    [merchantId],
  );
  const loading = merchantLoading || connectionLoading;
  const error = merchantError ?? connectionError;
  const [shopDomain, setShopDomain] = useState("");
  const [validationError, setValidationError] = useState<string | null>(null);
  const [callbackNotice, setCallbackNotice] = useState<"connected" | "error" | null>(null);

  // Reflect the redirect back from the OAuth callback (?shopify=connected|error).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("shopify");
    if (outcome === "connected" || outcome === "error") {
      setCallbackNotice(outcome);
      window.history.replaceState(null, "", window.location.pathname);
      if (outcome === "connected") {
        refetch();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  function handleConnect() {
    setValidationError(null);
    if (!merchantId) {
      setValidationError("Still determining your merchant account — try again in a moment.");
      return;
    }
    const trimmed = shopDomain.trim();
    if (!SHOP_DOMAIN_PATTERN.test(trimmed)) {
      setValidationError("Enter your store's *.myshopify.com domain, e.g. my-store.myshopify.com");
      return;
    }
    window.location.href = shopifyAuthorizeUrl(merchantId, trimmed);
  }

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div className="border-b border-[var(--border-secondary)] pb-5">
          <p
            className="font-mono text-xs uppercase tracking-widest text-[var(--foreground-muted)] mb-2"
            data-manifest-figure
          >
            Commerce
          </p>
          <h1 className="font-display text-2xl font-semibold text-[var(--foreground)]">
            Shopify integration
          </h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Connect your Shopify store using Shopify&apos;s own sign-in and approval screen.
          </p>
        </div>

        {callbackNotice === "connected" && (
          <div className="border border-[var(--clearance-teal)]/30 bg-[var(--clearance-teal)]/10 px-4 py-3 text-sm text-[var(--clearance-teal)]">
            Shopify approved the connection. Refreshing status below.
          </div>
        )}
        {callbackNotice === "error" && (
          <div className="border border-[var(--brand-red)]/30 bg-[var(--brand-red)]/10 px-4 py-3 text-sm text-[var(--brand-red)]">
            Shopify did not complete the connection. Please try again.
          </div>
        )}

        {loading ? (
          <Skeleton className="h-24 w-full" />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : data?.connected ? (
          <Card>
            <CardContent className="p-6">
              <div className="flex items-center gap-4">
                <div className="border border-[var(--border)] p-3 text-[var(--foreground-secondary)]">
                  <ShoppingBag className="h-6 w-6" />
                </div>
                <div>
                  <p
                    className="font-semibold text-[var(--foreground)] font-mono"
                    data-manifest-figure
                  >
                    {data.shopDomain}
                  </p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant="success">
                      <CheckCircle className="mr-1 h-3 w-3" />
                      Connected
                    </Badge>
                    {data.connectedAt && (
                      <span className="text-xs text-[var(--foreground-muted)]">
                        Since {new Date(data.connectedAt).toLocaleString()}
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </CardContent>
          </Card>
        ) : (
          <Card>
            <CardHeader>
              <CardTitle>Connect Shopify</CardTitle>
            </CardHeader>
            <CardContent className="space-y-3">
              <p className="text-sm text-[var(--foreground-secondary)]">
                Enter your store&apos;s domain. You&apos;ll be sent to Shopify to approve access —
                Counter never sees your Shopify password.
              </p>
              <div className="flex flex-col gap-2 sm:flex-row">
                <Input
                  value={shopDomain}
                  onChange={(event) => setShopDomain(event.target.value)}
                  placeholder="my-store.myshopify.com"
                  className="sm:max-w-sm"
                />
                <Button onClick={handleConnect}>
                  <ShoppingBag className="mr-2 h-3.5 w-3.5" />
                  Connect Shopify
                </Button>
              </div>
              {validationError && (
                <p className="text-sm text-[var(--brand-red)]">{validationError}</p>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </PageWrapper>
  );
}
