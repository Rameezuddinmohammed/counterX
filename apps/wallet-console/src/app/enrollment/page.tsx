"use client";

import { Card, CardContent, CardHeader, CardTitle, Badge } from "@counter/ui";
import { UserCheck, CheckCircle2, Circle } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";

interface EnrollmentStep {
  id: string;
  title: string;
  description: string;
  completed: boolean;
}

const ENROLLMENT_STEPS: EnrollmentStep[] = [
  {
    id: "step-1",
    title: "Account Creation",
    description: "Create your Counter wallet account with email verification",
    completed: true,
  },
  {
    id: "step-2",
    title: "Identity Verification",
    description: "Complete KYC with government-issued ID and selfie",
    completed: true,
  },
  {
    id: "step-3",
    title: "Device Registration",
    description: "Pair your primary device with biometric authentication",
    completed: true,
  },
  {
    id: "step-4",
    title: "Payment Method",
    description: "Link a bank account or UPI ID for transactions",
    completed: true,
  },
  {
    id: "step-5",
    title: "Policy Acceptance",
    description: "Review and accept the buyer protection policy",
    completed: true,
  },
  {
    id: "step-6",
    title: "First Transaction",
    description: "Complete a test transaction to activate the wallet",
    completed: false,
  },
];

export default function EnrollmentPage() {
  const completedCount = ENROLLMENT_STEPS.filter((s) => s.completed).length;
  const progress = Math.round((completedCount / ENROLLMENT_STEPS.length) * 100);

  return (
    <PageWrapper>
      <div className="space-y-6 max-w-3xl">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Enrollment</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Complete all steps to fully activate your wallet.
          </p>
        </div>

        <Card className="border-[var(--brand-orange)]/20">
          <CardContent className="p-6">
            <div className="flex items-center justify-between mb-4">
              <div className="flex items-center gap-3">
                <div className="rounded-xl bg-[var(--brand-orange)]/10 p-3">
                  <UserCheck className="h-6 w-6 text-[var(--brand-orange)]" />
                </div>
                <div>
                  <p className="font-semibold text-[var(--foreground)]">Enrollment Progress</p>
                  <p className="text-sm text-[var(--foreground-muted)]">
                    {completedCount} of {ENROLLMENT_STEPS.length} steps complete
                  </p>
                </div>
              </div>
              <Badge variant={progress === 100 ? "success" : "warning"}>{progress}%</Badge>
            </div>
            <div className="h-2 rounded-full bg-[var(--surface-secondary)] overflow-hidden">
              <div
                className="h-full rounded-full bg-[var(--brand-orange)] transition-all duration-500"
                style={{ width: progress + "%" }}
              />
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle>Enrollment Steps</CardTitle>
          </CardHeader>
          <CardContent className="p-0">
            <div className="divide-y divide-[var(--border)]">
              {ENROLLMENT_STEPS.map((step, i) => (
                <div key={step.id} className="px-5 py-4 flex items-start gap-4">
                  <div className="mt-0.5">
                    {step.completed ? (
                      <CheckCircle2 className="h-5 w-5 text-green-500" />
                    ) : (
                      <Circle className="h-5 w-5 text-[var(--foreground-muted)]" />
                    )}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <p
                        className={
                          "text-sm font-medium " +
                          (step.completed
                            ? "text-[var(--foreground)]"
                            : "text-[var(--foreground-muted)]")
                        }
                      >
                        {step.title}
                      </p>
                      {step.completed && (
                        <Badge variant="success" className="text-[10px]">
                          Done
                        </Badge>
                      )}
                      {!step.completed && i === completedCount && (
                        <Badge variant="warning" className="text-[10px]">
                          Next
                        </Badge>
                      )}
                    </div>
                    <p className="mt-0.5 text-xs text-[var(--foreground-muted)]">
                      {step.description}
                    </p>
                  </div>
                  <span className="text-xs text-[var(--foreground-muted)] tabular-nums">
                    Step {i + 1}
                  </span>
                </div>
              ))}
            </div>
          </CardContent>
        </Card>
      </div>
    </PageWrapper>
  );
}
