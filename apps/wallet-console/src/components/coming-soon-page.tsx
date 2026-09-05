/**
 * Honest placeholder for a page whose feature has no real backend yet.
 * Replaces pages that used to render plausible-looking invented data
 * (MOCK_* arrays) with fully interactive controls that did nothing —
 * misleading, since nothing a viewer clicked here ever took effect.
 */
import type { ComponentType } from "react";
import { Card, CardContent, Badge } from "@counter/ui";
import { PageWrapper } from "@/components/page-wrapper";

interface ComingSoonPageProps {
  readonly title: string;
  readonly description: string;
  readonly icon: ComponentType<{ className?: string }>;
}

export function ComingSoonPage({ title, description, icon: Icon }: ComingSoonPageProps) {
  return (
    <PageWrapper>
      <div className="space-y-6 opacity-60">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">{title}</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">{description}</p>
        </div>
        <Card>
          <CardContent className="flex items-center gap-4 p-6">
            <div className="rounded-lg bg-[var(--foreground-muted)]/10 p-3">
              <Icon className="h-6 w-6 text-[var(--foreground-muted)]" />
            </div>
            <div>
              <p className="font-semibold text-[var(--foreground)]">{title}</p>
              <Badge variant="secondary" className="mt-1">
                Coming soon
              </Badge>
            </div>
          </CardContent>
        </Card>
      </div>
    </PageWrapper>
  );
}
