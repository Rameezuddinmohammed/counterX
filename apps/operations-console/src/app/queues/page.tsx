"use client";

import { Card, CardContent, CardHeader, CardTitle, Button } from "@counter/ui";
import { ListOrdered, Play, Trash2 } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";

const MOCK_QUEUES = [
  {
    name: "transactions",
    depth: 0,
    throughput: "142/s",
    deadLetters: 0,
    health: "healthy" as const,
  },
  {
    name: "reconciliation",
    depth: 0,
    throughput: "28/s",
    deadLetters: 0,
    health: "healthy" as const,
  },
  {
    name: "notifications",
    depth: 0,
    throughput: "85/s",
    deadLetters: 0,
    health: "healthy" as const,
  },
  { name: "webhooks", depth: 0, throughput: "64/s", deadLetters: 0, health: "healthy" as const },
];

function QueueHealthBadge({ health }: { health: "healthy" | "degraded" | "critical" }) {
  const styles: Record<string, string> = {
    healthy: "bg-green-500/10 text-green-500 border-green-500/20",
    degraded: "bg-yellow-500/10 text-yellow-500 border-yellow-500/20",
    critical: "bg-red-500/10 text-red-500 border-red-500/20",
  };
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium ${styles[health]}`}
    >
      {health}
    </span>
  );
}

export default function QueuesPage() {
  return (
    <PageWrapper>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Queue Monitoring</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Monitor job queue depth, throughput, and dead letter counts.
          </p>
        </div>

        {/* Queue Cards */}
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2">
          {MOCK_QUEUES.map((queue) => (
            <Card
              key={queue.name}
              className="transition-all hover:border-[var(--border-secondary)]"
            >
              <CardHeader className="pb-3">
                <div className="flex items-center justify-between">
                  <CardTitle className="flex items-center gap-2 text-base">
                    <ListOrdered className="h-4 w-4 text-[var(--foreground-muted)]" />
                    {queue.name}
                  </CardTitle>
                  <QueueHealthBadge health={queue.health} />
                </div>
              </CardHeader>
              <CardContent className="space-y-4">
                <div className="grid grid-cols-3 gap-4">
                  <div>
                    <p className="text-xs text-[var(--foreground-muted)]">Depth</p>
                    <p className="text-lg font-semibold text-[var(--foreground)]">{queue.depth}</p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--foreground-muted)]">Throughput</p>
                    <p className="text-lg font-semibold text-[var(--foreground)]">
                      {queue.throughput}
                    </p>
                  </div>
                  <div>
                    <p className="text-xs text-[var(--foreground-muted)]">Dead Letters</p>
                    <p className="text-lg font-semibold text-[var(--foreground)]">
                      {queue.deadLetters}
                    </p>
                  </div>
                </div>

                {/* Progress Bar */}
                <div>
                  <div className="flex items-center justify-between text-xs text-[var(--foreground-muted)] mb-1">
                    <span>Capacity Usage</span>
                    <span>0%</span>
                  </div>
                  <div className="h-1.5 w-full rounded-full bg-[var(--surface-secondary)]">
                    <div className="h-full rounded-full bg-green-500" style={{ width: "2%" }} />
                  </div>
                </div>

                <div className="flex items-center gap-2">
                  <Button size="sm" variant="outline" className="flex items-center gap-1.5">
                    <Play className="h-3 w-3" />
                    Replay
                  </Button>
                  <Button size="sm" variant="outline" className="flex items-center gap-1.5">
                    <Trash2 className="h-3 w-3" />
                    Drain
                  </Button>
                </div>
              </CardContent>
            </Card>
          ))}
        </div>
      </div>
    </PageWrapper>
  );
}
