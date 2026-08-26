"use client";

import { useState } from "react";
import { Card, CardContent, Badge } from "@counter/ui";
import { UserPlus, CheckCircle, Clock } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";
import type { LifecyclePhase } from "@/lib/types";

const LIFECYCLE_STEPS: { phase: LifecyclePhase; label: string; description: string }[] = [
  { phase: "invited", label: "Invited", description: "Invitation sent to merchant" },
  { phase: "accepted", label: "Accepted", description: "Invitation accepted" },
  { phase: "onboarding", label: "Onboarding", description: "Setup in progress" },
  { phase: "active", label: "Active", description: "Fully operational" },
];

export default function InvitePage() {
  const [currentPhase] = useState<LifecyclePhase>("onboarding");
  const currentIndex = LIFECYCLE_STEPS.findIndex((s) => s.phase === currentPhase);

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Invitation & Lifecycle</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">Your merchant account lifecycle status.</p>
        </div>
        <Card>
          <CardContent className="p-6">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-4">
                <div className="rounded-lg bg-[var(--brand-orange)]/10 p-3"><UserPlus className="h-6 w-6 text-[var(--brand-orange)]" /></div>
                <div><p className="font-semibold text-[var(--foreground)]">Merchant Pilot-001</p><p className="text-sm text-[var(--foreground-muted)]">admin@merchant-pilot.com</p></div>
              </div>
              <Badge variant="success">Onboarding</Badge>
            </div>
          </CardContent>
        </Card>
        <Card>
          <CardContent className="p-6">
            <h3 className="mb-6 text-lg font-semibold text-[var(--foreground)]">Lifecycle Progress</h3>
            <div className="space-y-4">
              {LIFECYCLE_STEPS.map((step, index) => {
                const isComplete = index < currentIndex;
                const isCurrent = index === currentIndex;
                return (
                  <div key={step.phase} className="flex items-start gap-4">
                    <div className="flex flex-col items-center">
                      <div className={`flex h-8 w-8 items-center justify-center rounded-full ${isComplete ? "bg-emerald-500" : isCurrent ? "bg-[var(--brand-orange)]" : "bg-[var(--surface-secondary)] border border-[var(--border)]"}`}>
                        {isComplete ? <CheckCircle className="h-4 w-4 text-white" /> : isCurrent ? <Clock className="h-4 w-4 text-white" /> : <div className="h-2 w-2 rounded-full bg-[var(--foreground-muted)]" />}
                      </div>
                      {index < LIFECYCLE_STEPS.length - 1 && <div className={`mt-1 h-8 w-0.5 ${isComplete ? "bg-emerald-500" : "bg-[var(--border)]"}`} />}
                    </div>
                    <div className="pb-4">
                      <p className={`font-medium ${isComplete || isCurrent ? "text-[var(--foreground)]" : "text-[var(--foreground-muted)]"}`}>{step.label}</p>
                      <p className="text-sm text-[var(--foreground-muted)]">{step.description}</p>
                    </div>
                  </div>
                );
              })}
            </div>
          </CardContent>
        </Card>
      </div>
    </PageWrapper>
  );
}
