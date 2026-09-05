"use client";

import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Avatar,
  AvatarFallback,
  Badge,
  Separator,
  Skeleton,
} from "@counter/ui";
import { User, Mail, Shield, Clock, Globe } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";
import { useApi, useCurrentMerchantId } from "@/hooks/use-api";
import type { ShopifyConnectionStatus } from "@/lib/types";

export default function ProfilePage() {
  const { merchantId } = useCurrentMerchantId();
  const { data: shopify, loading: shopifyLoading } = useApi(
    (client) =>
      merchantId
        ? client.getShopifyConnectionStatus(merchantId)
        : Promise.resolve({
            ok: true as const,
            data: { connected: false } satisfies ShopifyConnectionStatus,
          }),
    [merchantId],
  );

  return (
    <PageWrapper>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Profile</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Your account information and connected services.
          </p>
        </div>

        {/* Profile Card */}
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center gap-6">
              <Avatar className="h-20 w-20">
                <AvatarFallback className="bg-[var(--brand-orange)]/20 text-[var(--brand-orange)] text-2xl font-bold">
                  MC
                </AvatarFallback>
              </Avatar>
              <div>
                <h2 className="text-xl font-bold text-[var(--foreground)]">Merchant Pilot</h2>
                <p className="text-[var(--foreground-secondary)]">admin@merchant-pilot.com</p>
                <div className="mt-2 flex items-center gap-2">
                  <Badge variant="default">Admin</Badge>
                  <Badge variant="success">Active</Badge>
                </div>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Details */}
        <Card>
          <CardHeader>
            <CardTitle>Account Details</CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex items-center gap-3">
              <User className="h-4 w-4 text-[var(--foreground-muted)]" />
              <div className="flex-1">
                <p className="text-sm text-[var(--foreground-secondary)]">Name</p>
                <p className="text-sm font-medium text-[var(--foreground)]">Merchant Pilot</p>
              </div>
            </div>
            <Separator />
            <div className="flex items-center gap-3">
              <Mail className="h-4 w-4 text-[var(--foreground-muted)]" />
              <div className="flex-1">
                <p className="text-sm text-[var(--foreground-secondary)]">Email</p>
                <p className="text-sm font-medium text-[var(--foreground)]">
                  admin@merchant-pilot.com
                </p>
              </div>
            </div>
            <Separator />
            <div className="flex items-center gap-3">
              <Shield className="h-4 w-4 text-[var(--foreground-muted)]" />
              <div className="flex-1">
                <p className="text-sm text-[var(--foreground-secondary)]">Role</p>
                <p className="text-sm font-medium text-[var(--foreground)]">Administrator</p>
              </div>
            </div>
            <Separator />
            <div className="flex items-center gap-3">
              <Clock className="h-4 w-4 text-[var(--foreground-muted)]" />
              <div className="flex-1">
                <p className="text-sm text-[var(--foreground-secondary)]">Last Login</p>
                <p className="text-sm font-medium text-[var(--foreground)]">Recently</p>
              </div>
            </div>
            <Separator />
            <div className="flex items-center gap-3">
              <Globe className="h-4 w-4 text-[var(--foreground-muted)]" />
              <div className="flex-1">
                <p className="text-sm text-[var(--foreground-secondary)]">Environment</p>
                <p className="text-sm font-medium text-[var(--foreground)]">Pilot (Test Mode)</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Connected Accounts */}
        <Card>
          <CardHeader>
            <CardTitle>Connected Accounts</CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            {shopifyLoading ? (
              <Skeleton className="h-14 w-full" />
            ) : (
              <div className="flex items-center justify-between rounded-lg border border-[var(--border)] p-3">
                <div className="flex items-center gap-3">
                  <div className="h-8 w-8 rounded-lg bg-[#96BF48]/10 flex items-center justify-center">
                    <span className="text-xs font-bold text-[#96BF48]">S</span>
                  </div>
                  <div>
                    <p className="text-sm font-medium text-[var(--foreground)]">Shopify</p>
                    <p className="text-xs text-[var(--foreground-muted)]">
                      {shopify?.connected ? shopify.shopDomain : "Not connected"}
                    </p>
                  </div>
                </div>
                <Badge variant={shopify?.connected ? "success" : "secondary"}>
                  {shopify?.connected ? "Connected" : "Not connected"}
                </Badge>
              </div>
            )}
            <div className="flex items-center justify-between rounded-lg border border-[var(--border)] p-3">
              <div className="flex items-center gap-3">
                <div className="h-8 w-8 rounded-lg bg-blue-500/10 flex items-center justify-center">
                  <span className="text-xs font-bold text-blue-500">R</span>
                </div>
                <div>
                  <p className="text-sm font-medium text-[var(--foreground)]">Razorpay</p>
                  <p className="text-xs text-[var(--foreground-muted)]">Payment configuration</p>
                </div>
              </div>
              <Badge variant="secondary">Coming soon</Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageWrapper>
  );
}
