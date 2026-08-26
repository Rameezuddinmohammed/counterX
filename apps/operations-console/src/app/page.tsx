"use client";

import { StatCard, Card, CardContent, Badge } from "@counter/ui";
import { Server, AlertTriangle, ListOrdered, Power, Headphones, Plug } from "lucide-react";
import Link from "next/link";
import { PageWrapper } from "@/components/page-wrapper";

const QUICK_ACTIONS = [
  { label: "Fleet Health", href: "/fleet", icon: Server, description: "Check dependency status" },
  { label: "Incidents", href: "/incidents", icon: AlertTriangle, description: "Manage active incidents" },
  { label: "Queues", href: "/queues", icon: ListOrdered, description: "Monitor job queues" },
  { label: "Kill Switches", href: "/kill-switches", icon: Power, description: "Toggle feature flags" },
  { label: "Support", href: "/support", icon: Headphones, description: "Active support sessions" },
  { label: "Adapters", href: "/adapters", icon: Plug, description: "Adapter deployment status" },
];

export default function OperationsDashboard() {
  return (
    <PageWrapper>
      <div className="space-y-8">
        {/* Welcome Section */}
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">
            Operations Center
          </h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Platform health overview and system monitoring dashboard.
          </p>
        </div>

        {/* System Status Banner */}
        <Card className="border-green-500/20 bg-green-500/5">
          <CardContent className="p-4">
            <div className="flex items-center gap-3">
              <span className="relative flex h-3 w-3">
                <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
                <span className="relative inline-flex h-3 w-3 rounded-full bg-green-500" />
              </span>
              <div>
                <p className="text-sm font-medium text-[var(--foreground)]">All Systems Operational</p>
                <p className="text-xs text-[var(--foreground-muted)]">Uptime: 99.97% | Success Rate: 99.8%</p>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Stat Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard
            icon={<AlertTriangle className="h-4 w-4" />}
            label="Active Incidents"
            value="0"
            description="All systems nominal"
          />
          <StatCard
            icon={<ListOrdered className="h-4 w-4" />}
            label="Queue Depth"
            value="0"
            description="No pending jobs"
          />
          <StatCard
            icon={<Power className="h-4 w-4" />}
            label="Kill Switches"
            value="0"
            description="None active"
          />
          <StatCard
            icon={<Headphones className="h-4 w-4" />}
            label="Support Sessions"
            value="0"
            description="No active grants"
          />
        </div>

        {/* Quick Navigation */}
        <div>
          <h2 className="mb-4 text-lg font-semibold text-[var(--foreground)]">Quick Navigation</h2>
          <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
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

        {/* Recent Activity */}
        <div>
          <h2 className="mb-4 text-lg font-semibold text-[var(--foreground)]">Recent Activity</h2>
          <Card>
            <CardContent className="p-0">
              <div className="divide-y divide-[var(--border)]">
                {[
                  { action: "Fleet health check passed", detail: "All dependencies healthy", time: "2 min ago", badge: "healthy" },
                  { action: "Queue drain completed", detail: "transactions queue at 0", time: "15 min ago", badge: "completed" },
                  { action: "Adapter deployed", detail: "razorpay-adapter v2.1.0", time: "1 hour ago", badge: "deployed" },
                  { action: "Support session expired", detail: "Grant for merchant m-42", time: "3 hours ago", badge: "expired" },
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
