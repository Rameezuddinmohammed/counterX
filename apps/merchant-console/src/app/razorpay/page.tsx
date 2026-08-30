"use client";

import { Card, CardContent, CardHeader, CardTitle, Badge, StatCard } from "@counter/ui";
import { CreditCard, Activity, CheckCircle } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";

export default function RazorpayPage() {
  return (
    <PageWrapper>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Razorpay Status</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Payment processing configuration and health.
          </p>
        </div>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="rounded-lg bg-blue-500/10 p-3">
                  <CreditCard className="h-6 w-6 text-blue-500" />
                </div>
                <div>
                  <p className="font-semibold text-[var(--foreground)]">Razorpay Account</p>
                  <div className="mt-1 flex items-center gap-2">
                    <Badge variant="success">Connected</Badge>
                    <Badge variant="warning">Test Mode</Badge>
                  </div>
                </div>
              </div>
              <div className="text-right">
                <p className="text-xs text-[var(--foreground-muted)]">Account ID</p>
                <p className="font-mono text-sm text-[var(--foreground)]">acc_test_001</p>
              </div>
            </div>
          </CardContent>
        </Card>
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
          <StatCard
            icon={<Activity className="h-4 w-4" />}
            label="Webhook Status"
            value="Active"
            description="Last ping: 5 min ago"
          />
          <StatCard
            icon={<CheckCircle className="h-4 w-4" />}
            label="Key Configured"
            value="Yes"
            description="Test key active"
          />
          <StatCard
            icon={<CreditCard className="h-4 w-4" />}
            label="Payment Methods"
            value="4"
            description="UPI, Card, Net Banking, Wallet"
          />
        </div>
        <Card>
          <CardHeader>
            <CardTitle>Supported Payment Methods</CardTitle>
          </CardHeader>
          <CardContent>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
              {["UPI", "Credit/Debit Card", "Net Banking", "Wallet"].map((method) => (
                <div
                  key={method}
                  className="flex items-center gap-2 rounded-lg border border-[var(--border)] p-3"
                >
                  <CheckCircle className="h-4 w-4 text-emerald-500" />
                  <span className="text-sm text-[var(--foreground)]">{method}</span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </PageWrapper>
  );
}
