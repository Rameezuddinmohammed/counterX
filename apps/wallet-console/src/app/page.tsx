"use client";

import { StatCard, Card, CardContent, Badge } from "@counter/ui";
import {
  FileText,
  CheckCircle2,
  ArrowLeftRight,
  Smartphone,
  Zap,
  Wallet,
  Download,
} from "lucide-react";
import Link from "next/link";
import { PageWrapper } from "@/components/page-wrapper";

const QUICK_ACTIONS = [
  { label: "View Transactions", href: "/transactions", icon: ArrowLeftRight, description: "Browse recent activity" },
  { label: "Manage Devices", href: "/devices", icon: Smartphone, description: "Pair or unpair devices" },
  { label: "Review Approvals", href: "/approvals", icon: CheckCircle2, description: "Pending authorization requests" },
  { label: "Export Data", href: "/export", icon: Download, description: "Download wallet records" },
];

export default function DashboardPage() {
  return (
    <PageWrapper>
      <div className="space-y-8">
        {/* Welcome Section */}
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">
            Wallet Overview
          </h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Monitor your wallet status, recent activity, and pending actions.
          </p>
        </div>

        {/* Wallet ID Card */}
        <Card className="border-[var(--brand-orange)]/20 bg-gradient-to-r from-[var(--brand-orange)]/5 to-transparent">
          <CardContent className="p-5">
            <div className="flex items-center gap-4">
              <div className="rounded-xl bg-[var(--brand-orange)]/10 p-3">
                <Wallet className="h-6 w-6 text-[var(--brand-orange)]" />
              </div>
              <div className="flex-1">
                <p className="text-sm text-[var(--foreground-secondary)]">Wallet ID</p>
                <p className="text-lg font-mono font-semibold text-[var(--foreground)]">wlt-pilot-001</p>
              </div>
              <div className="flex items-center gap-2">
                <span className="h-2 w-2 rounded-full bg-green-500 animate-pulse" />
                <Badge variant="success">Active</Badge>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stat Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-5">
          <StatCard
            icon={<FileText className="h-4 w-4" />}
            label="Active Mandates"
            value="3"
            description="Standing authorizations"
          />
          <StatCard
            icon={<CheckCircle2 className="h-4 w-4" />}
            label="Pending Approvals"
            value="1"
            trend={{ value: 1, direction: "down", label: "vs last week" }}
          />
          <StatCard
            icon={<ArrowLeftRight className="h-4 w-4" />}
            label="Recent Transactions"
            value="12"
            trend={{ value: 8, direction: "up", label: "vs last month" }}
          />
          <StatCard
            icon={<Smartphone className="h-4 w-4" />}
            label="Paired Devices"
            value="2"
            description="All devices active"
          />
          <StatCard
            icon={<Zap className="h-4 w-4" />}
            label="Active Triggers"
            value="4"
            description="Automation rules running"
          />
        </div>

        {/* Quick Actions */}
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

        {/* Recent Activity Feed */}
        <div>
          <h2 className="mb-4 text-lg font-semibold text-[var(--foreground)]">Recent Activity</h2>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-[var(--border)]">
                {[
                  { action: "Transaction approved", detail: "INR 2,500 to MerchantCo", time: "5 min ago", badge: "approved" },
                  { action: "Device paired", detail: "iPhone 15 Pro added", time: "2 hours ago", badge: "paired" },
                  { action: "Mandate created", detail: "Monthly subscription - StreamFlix", time: "1 day ago", badge: "active" },
                  { action: "Security check passed", detail: "Biometric verification successful", time: "2 days ago", badge: "verified" },
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
