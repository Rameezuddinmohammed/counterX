"use client";

import Link from "next/link";
import { Check } from "lucide-react";

export interface OnboardingStep {
  readonly stepNumber: number;
  readonly title: string;
  readonly href: string;
}

export const ONBOARDING_STEPS: readonly OnboardingStep[] = [
  { stepNumber: 1, title: "Business details", href: "/invite/business-basics" },
  { stepNumber: 2, title: "Connect catalog", href: "/invite/catalog-connect" },
  { stepNumber: 3, title: "Review catalog", href: "/invite/catalog-review" },
  { stepNumber: 4, title: "Readiness check", href: "/invite/readiness" },
  { stepNumber: 5, title: "Confirm & launch", href: "/invite/manifest" },
];

interface OnboardingStepperProps {
  readonly currentStep: number;
}

export function OnboardingStepper({ currentStep }: OnboardingStepperProps) {
  return (
    <nav aria-label="Onboarding progress" className="w-full pb-2">
      <ol className="flex items-center justify-between gap-2 sm:gap-4">
        {ONBOARDING_STEPS.map((step, index) => {
          const isCompleted = step.stepNumber < currentStep;
          const isCurrent = step.stepNumber === currentStep;
          const isLast = index === ONBOARDING_STEPS.length - 1;

          const stepIndicator = (
            <div className="flex items-center gap-2 group">
              <div
                className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-xs font-mono font-medium transition-colors ${
                  isCompleted
                    ? "bg-[var(--brand-red)] text-white"
                    : isCurrent
                      ? "border-2 border-[var(--brand-red)] text-[var(--brand-red)] bg-[var(--surface)]"
                      : "border border-[var(--border)] text-[var(--foreground-muted)] bg-[var(--surface-secondary)]"
                }`}
              >
                {isCompleted ? <Check className="h-3.5 w-3.5" /> : step.stepNumber}
              </div>
              <span
                className={`hidden md:inline text-xs font-medium transition-colors ${
                  isCurrent
                    ? "text-[var(--foreground)] font-semibold"
                    : isCompleted
                      ? "text-[var(--foreground-secondary)] group-hover:text-[var(--foreground)]"
                      : "text-[var(--foreground-muted)]"
                }`}
              >
                {step.title}
              </span>
            </div>
          );

          return (
            <li key={step.stepNumber} className={`flex items-center ${isLast ? "" : "flex-1"}`}>
              {isCompleted ? (
                <Link href={step.href} className="no-underline">
                  {stepIndicator}
                </Link>
              ) : (
                stepIndicator
              )}

              {!isLast && (
                <div
                  className={`ml-2 sm:ml-4 h-0.5 flex-1 transition-colors ${
                    step.stepNumber < currentStep ? "bg-[var(--brand-red)]" : "bg-[var(--border)]"
                  }`}
                  aria-hidden="true"
                />
              )}
            </li>
          );
        })}
      </ol>
    </nav>
  );
}
