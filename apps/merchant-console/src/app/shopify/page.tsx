"use client";

/**
 * Real self-serve Shopify connect. Shows the REAL connection status from
 * control-plane-api's shopify_connections table (GET
 * /control/v1/merchants/:merchantId/shopify/connection) and offers whichever
 * connect path this deployment can actually complete:
 *
 *  - One-click OAuth (`oauthAvailable: true`) — navigates the browser to the
 *    REAL authorization-code-grant start (GET .../shopify/authorize), which
 *    redirects to Shopify's own consent screen. Requires a Shopify app
 *    (SHOPIFY_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI) on the server.
 *
 *  - Admin API access token (always available) — the merchant creates a
 *    custom app in their own Shopify admin and pastes its token here. POSTed
 *    to .../shopify/connection, where the server proves the token against
 *    Shopify's real Admin API and checks its scopes BEFORE storing anything,
 *    so a stored connection is never one that would fail at purchase time.
 *
 * The console never guesses which path works — the status response says so.
 * Previously this page offered only the one-click button, and on a
 * deployment with no Shopify app configured the whole route family was
 * unregistered, so the page showed a bare "Access denied"/"Resource not
 * found" with no way forward (found by clicking through the real console,
 * 2026-09-05).
 *
 * merchantId is the real, signed-in merchant's id (useCurrentMerchantId,
 * decoded from the access token control-plane-api already verifies on
 * every request) — not a hardcoded placeholder.
 */

import { useEffect, useState } from "react";
import Link from "next/link";
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
import { ShoppingBag, CheckCircle, KeyRound, ExternalLink, ArrowRight } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";
import { ensureStepUp, getApiClient, useApi, useCurrentMerchantId } from "@/hooks/use-api";
import type { ShopifyConnectionStatus } from "@/lib/types";

const CONTROL_PLANE_BASE_URL = process.env["NEXT_PUBLIC_API_BASE_URL"] ?? "/control/v1";

const SHOP_DOMAIN_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9-]*\.myshopify\.com$/;

function shopifyAuthorizeUrl(merchantId: string, shopDomain: string): string {
  const base =
    CONTROL_PLANE_BASE_URL.startsWith("http://") || CONTROL_PLANE_BASE_URL.startsWith("https://")
      ? CONTROL_PLANE_BASE_URL
      : `${typeof window !== "undefined" ? window.location.origin : "http://localhost:3000"}${CONTROL_PLANE_BASE_URL}`;
  const url = new URL(`${base}/merchants/${encodeURIComponent(merchantId)}/shopify/authorize`);
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
  const [accessToken, setAccessToken] = useState("");
  const [connectError, setConnectError] = useState<string | null>(null);
  const [connecting, setConnecting] = useState(false);
  const [callbackNotice, setCallbackNotice] = useState<"connected" | "error" | null>(null);
  const [appState, setAppState] = useState<string | null>(null);

  useEffect(() => {
    if (merchantId) {
      void getApiClient()
        .getMerchantApplication(merchantId)
        .then((res) => {
          if (res.ok) setAppState(res.data.lifecycleState);
        });
    }
  }, [merchantId]);

  // Reflect the redirect back from the OAuth callback (?shopify=connected|error).
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const outcome = params.get("shopify");
    if (outcome === "connected" || outcome === "error") {
      setCallbackNotice(outcome);
      window.history.replaceState(null, "", window.location.pathname);
      if (outcome === "connected") {
        if (merchantId) {
          void getApiClient().markCatalogConnected(merchantId);
        }
        refetch();
      }
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [merchantId]);

  function validatedShopDomain(): string | null {
    const trimmed = shopDomain.trim().toLowerCase();
    if (!SHOP_DOMAIN_PATTERN.test(trimmed)) {
      setConnectError(
        "Enter your store's .myshopify.com address, e.g. my-store.myshopify.com — not your custom domain.",
      );
      return null;
    }
    return trimmed;
  }

  function handleOAuthConnect() {
    setConnectError(null);
    if (!merchantId) {
      setConnectError("Still determining your merchant account — try again in a moment.");
      return;
    }
    const trimmed = validatedShopDomain();
    if (trimmed === null) return;
    window.location.href = shopifyAuthorizeUrl(merchantId, trimmed);
  }

  async function handleTokenConnect() {
    setConnectError(null);
    if (!merchantId) {
      setConnectError("Still determining your merchant account — try again in a moment.");
      return;
    }
    const trimmed = validatedShopDomain();
    if (trimmed === null) return;
    if (accessToken.trim().length === 0) {
      setConnectError("Paste the Admin API access token from your custom app.");
      return;
    }

    // Raise the session's assurance before the write — connecting a store is
    // a tenant mutation the API gates behind a second factor. First await in
    // the handler so the popup stays attributable to the user's click.
    try {
      await ensureStepUp();
    } catch {
      setConnectError("Verification was not completed, so the store was not connected.");
      return;
    }

    setConnecting(true);
    const result = await getApiClient().connectShopifyWithToken(merchantId, {
      shopDomain: trimmed,
      accessToken: accessToken.trim(),
    });
    setConnecting(false);

    if (!result.ok) {
      // The server's message is written for the merchant (wrong token,
      // wrong store, missing scopes) — show it rather than a generic
      // "something went wrong".
      setConnectError(result.error.message);
      return;
    }

    void getApiClient().markCatalogConnected(merchantId);
    setAccessToken("");
    setCallbackNotice("connected");
    refetch();
  }

  const oauthAvailable = data?.oauthAvailable === true;

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2 mb-1">
              <span className="text-xs uppercase font-bold tracking-wider text-cyan-600 dark:text-cyan-400">
                Commerce Integration
              </span>
              <span className="text-[10px] uppercase font-semibold px-2 py-0.5 rounded-full bg-indigo-500/15 text-indigo-500 border border-indigo-500/30">
                Shopify
              </span>
            </div>
            <h1 className="text-3xl font-extrabold tracking-tight text-[var(--foreground)]">
              Shopify Integration
            </h1>
            <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
              Connect your Shopify store so autonomous AI agents can browse your catalog and place real orders.
            </p>
          </div>
        </div>

        {appState && appState !== "ACTIVE" && (
          <div className="rounded-2xl border border-indigo-500/30 bg-indigo-500/10 p-5 flex flex-col sm:flex-row sm:items-center justify-between gap-4 shadow-sm">
            <div>
              <p className="text-sm font-bold text-[var(--foreground)]">Onboarding in progress</p>
              <p className="text-xs text-[var(--foreground-secondary)] mt-0.5">
                {data?.connected
                  ? "Your Shopify store is connected. You can now review your catalog in Step 3."
                  : "Connect your Shopify store here to complete Step 2 of the setup wizard."}
              </p>
            </div>
            <Link
              href={data?.connected ? "/invite/catalog-review" : "/invite/catalog-connect"}
              className="no-underline shrink-0"
            >
              <Button size="sm" variant={data?.connected ? "default" : "outline"} className="gap-1.5">
                {data?.connected ? "Continue to Step 3: Review Catalog" : "Return to Setup Wizard"}
                <ArrowRight className="h-3.5 w-3.5" />
              </Button>
            </Link>
          </div>
        )}

        {callbackNotice === "connected" && (
          <div className="rounded-2xl border border-emerald-500/30 bg-emerald-500/10 p-4 text-xs font-semibold text-emerald-600 dark:text-emerald-400 flex items-center gap-2">
            <CheckCircle className="h-4 w-4" />
            Store connected successfully. Products are synchronizing with your Counter agent catalog.
          </div>
        )}
        {callbackNotice === "error" && (
          <div className="rounded-2xl border border-rose-500/30 bg-rose-500/10 p-4 text-xs font-semibold text-rose-600 dark:text-rose-400">
            Shopify did not complete the connection. Please verify your shop domain and try again.
          </div>
        )}

        {loading ? (
          <Skeleton className="h-28 w-full rounded-2xl" />
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : data?.connected ? (
          <Card className="border-emerald-500/30 bg-gradient-to-br from-emerald-950/10 via-[var(--surface)] to-[var(--surface)] shadow-lg">
            <CardContent className="p-6">
              <div className="flex items-center justify-between flex-wrap gap-4">
                <div className="flex items-center gap-4">
                  <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-600 dark:text-emerald-400 border border-emerald-500/30">
                    <ShoppingBag className="h-6 w-6" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <p className="font-bold text-base text-[var(--foreground)] font-mono">
                        {data.shopDomain}
                      </p>
                      <Badge variant="success">
                        <CheckCircle className="mr-1 h-3 w-3" />
                        Connected &bull; Active
                      </Badge>
                    </div>
                    {data.connectedAt && (
                      <p className="text-xs text-[var(--foreground-muted)] font-mono mt-1">
                        Connected on {new Date(data.connectedAt).toLocaleDateString()}
                      </p>
                    )}
                  </div>
                </div>

                {appState && appState !== "ACTIVE" && (
                  <Link href="/invite/catalog-review" className="no-underline">
                    <Button size="sm" className="gap-1.5 shadow-sm">
                      Continue to Catalog Review
                      <ArrowRight className="h-3.5 w-3.5" />
                    </Button>
                  </Link>
                )}
              </div>
            </CardContent>
          </Card>
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle>Connect your store</CardTitle>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="space-y-2">
                  <label
                    className="text-sm font-medium text-[var(--foreground)]"
                    htmlFor="shop-domain"
                  >
                    Your Shopify store address
                  </label>
                  <Input
                    id="shop-domain"
                    value={shopDomain}
                    onChange={(event) => setShopDomain(event.target.value)}
                    placeholder="my-store.myshopify.com"
                    className="sm:max-w-md"
                  />
                  <p className="text-xs text-[var(--foreground-muted)]">
                    Use the .myshopify.com address, not your custom domain.
                  </p>
                </div>

                {oauthAvailable && (
                  <div className="border-t border-[var(--border-secondary)] pt-4">
                    <p className="text-sm text-[var(--foreground-secondary)] mb-3">
                      You&apos;ll be sent to Shopify to approve access — Counter never sees your
                      Shopify password.
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
                        ? "Or connect with an access token"
                        : "Admin API access token"}
                    </p>
                    <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
                      In your Shopify admin, go to{" "}
                      <span className="font-mono text-xs">
                        Settings → Apps and sales channels → Develop apps
                      </span>
                      , create an app, give it the Admin API scopes{" "}
                      <span className="font-mono text-xs">read_products</span>,{" "}
                      <span className="font-mono text-xs">read_orders</span> and{" "}
                      <span className="font-mono text-xs">write_orders</span>, install it, then copy
                      the Admin API access token.
                    </p>
                    <a
                      href="https://help.shopify.com/en/manual/apps/app-types/custom-apps"
                      target="_blank"
                      rel="noreferrer"
                      className="mt-2 inline-flex items-center gap-1 text-xs text-[var(--brand-red)] underline"
                    >
                      Shopify&apos;s own instructions
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
                    <Button onClick={() => void handleTokenConnect()} disabled={connecting}>
                      <KeyRound className="mr-2 h-3.5 w-3.5" />
                      {connecting ? "Verifying with Shopify…" : "Connect store"}
                    </Button>
                  </div>
                  <p className="text-xs text-[var(--foreground-muted)]">
                    Counter checks this token against your store before saving it, so you find out
                    immediately if something is wrong.
                  </p>
                </div>

                {connectError && <p className="text-sm text-[var(--brand-red)]">{connectError}</p>}
              </CardContent>
            </Card>
          </>
        )}
      </div>
    </PageWrapper>
  );
}
