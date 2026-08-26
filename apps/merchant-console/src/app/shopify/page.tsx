"use client";

import { Card, CardContent, CardHeader, CardTitle, Badge, StatCard, Button } from "@counter/ui";
import { ShoppingBag, RefreshCw, CheckCircle, Package, ShoppingCart } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";

export default function ShopifyPage() {
  return (
    <PageWrapper>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Shopify Integration</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">Manage your Shopify store connection and sync status.</p>
        </div>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="rounded-lg bg-[#96BF48]/10 p-3"><ShoppingBag className="h-6 w-6 text-[#96BF48]" /></div>
                <div>
                  <p className="font-semibold text-[var(--foreground)]">store-pilot.myshopify.com</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant="success">Connected</Badge>
                    <span className="text-xs text-[var(--foreground-muted)]">Last sync: 1 hour ago</span>
                  </div>
                </div>
              </div>
              <Button variant="outline" size="sm"><RefreshCw className="mr-2 h-3.5 w-3.5" />Sync Now</Button>
            </div>
          </CardContent>
        </Card>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={<Package className="h-4 w-4" />} label="Products" value="42" description="All products synced" />
          <StatCard icon={<ShoppingCart className="h-4 w-4" />} label="Orders" value="186" trend={{ value: 8, direction: "up", label: "this week" }} />
          <StatCard icon={<CheckCircle className="h-4 w-4" />} label="Webhooks" value="Active" description="4 webhooks configured" />
          <StatCard icon={<RefreshCw className="h-4 w-4" />} label="Sync Progress" value="100%" description="All data current" />
        </div>
        <Card>
          <CardHeader><CardTitle>Configuration</CardTitle></CardHeader>
          <CardContent className="space-y-4">
            {["API Credentials", "Webhook Endpoints", "Product Sync"].map((label) => (
              <div key={label} className="flex items-center justify-between py-2 border-b border-[var(--border)] last:border-0">
                <span className="text-sm text-[var(--foreground-secondary)]">{label}</span>
                <div className="flex items-center gap-2"><CheckCircle className="h-4 w-4 text-emerald-500" /><span className="text-sm text-[var(--foreground)]">Valid</span></div>
              </div>
            ))}
          </CardContent>
        </Card>
      </div>
    </PageWrapper>
  );
}
