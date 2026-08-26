"use client";

import { StatCard, Card, CardContent, Badge } from "@counter/ui";
import { Receipt, Shield, Activity, Search, ShoppingBag, CreditCard, FileText } from "lucide-react";
import Link from "next/link";
import { PageWrapper } from "@/components/page-wrapper";

const QUICK_ACTIONS = [
  { label: "Connect Shopify", href: "/shopify", icon: ShoppingBag, description: "Set up your store integration" },
  { label: "Configure Razorpay", href: "/razorpay", icon: CreditCard, description: "Payment processing setup" },
  { label: "Run Policy Check", href: "/policy", icon: Shield, description: "Simulate policy rules" },
  { label: "View Manifest", href: "/manifest", icon: FileText, description: "Activation capabilities" },
];

export default function DashboardPage() {
  return (
    <PageWrapper>
      <div className="space-y-8">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Welcome back</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Here is an overview of your merchant account.
          </p>
        </div>

        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard icon={<Receipt className="h-4 w-4" />} label="Total Transactions" value="1,247" trend={{ value: 12, direction: "up", label: "vs last month" }} />
          <StatCard icon={<Shield className="h-4 w-4" />} label="Active Policies" value="8" description="All policies passing" />
          <StatCard icon={<Activity className="h-4 w-4" />} label="Readiness Score" value="94%" trend={{ value: 3, direction: "up", label: "improvement" }} />
          <StatCard icon={<Search className="h-4 w-4" />} label="Open Findings" value="2" trend={{ value: 1, direction: "down", label: "vs last week" }} />
        </div>

        <div>
          <h2 className="mb-4 text-lg font-semibold text-[var(--foreground)]">Quick Actions</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
            {QUICK_ACTIONS.map((action) => (
              <Link key={action.href} href={action.href} className="no-underline">
                <Card className="h-full transition-all duration-200 hover:border-[var(--brand-orange)]/30 hover:shadow-lg hover:shadow-[var(--brand-orange)]/5 cursor-pointer">
                  <CardContent className="p-5">
                    <div className="flex items-start gap-3">
                      <div className="rounded-lg bg-[var(--brand-orange)]/10 p-2">
                        <action.icon className="h-4 w-4 text-[var(--brand-orange)]" />
                      </div>
                      <div>
                        <p className="font-medium text-[var(--foreground)]">{action.label}</p>
                        <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">{action.description}</p>
                      </div>
                    </div>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>

        <div>
          <h2 className="mb-4 text-lg font-semibold text-[var(--foreground)]">Recent Activity</h2>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-[var(--border)]">
                {[
                  { action: "Transaction settled", detail: "INR 1,500 via UPI", time: "2 min ago", badge: "settled" },
                  { action: "Policy simulation passed", detail: "All rules satisfied", time: "15 min ago", badge: "passed" },
                  { action: "Shopify sync completed", detail: "42 products synced", time: "1 hour ago", badge: "synced" },
                  { action: "Readiness check passed", detail: "All blocking checks cleared", time: "3 hours ago", badge: "ready" },
                ].map((item, i) => (
                  <div key={i} className="flex items-center justify-between px-5 py-3.5">
                    <div>
                      <p className="text-sm font-medium text-[var(--foreground)]">{item.action}</p>
                      <p className="text-xs text-[var(--foreground-muted)]">{item.detail}</p>
                    </div>
                    <div className="flex items-center gap-3">
                      <Badge variant="secondary">{item.badge}</Badge>
                      <span className="text-xs text-[var(--foreground-muted)]">{item.time}</span>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        </div>
      </div>
    </PageWrapper>
  );
}
