import * as React from "react";
import { TrendingUp, TrendingDown } from "lucide-react";
import { cn } from "../lib/utils";

export interface StatCardProps extends React.HTMLAttributes<HTMLDivElement> {
  icon?: React.ReactNode;
  label: string;
  value: string | number;
  trend?: {
    value: number;
    label?: string;
    direction: "up" | "down";
  };
  description?: string;
}

export function StatCard({
  icon,
  label,
  value,
  trend,
  description,
  className,
  ...props
}: StatCardProps) {
  return (
    <div
      className={cn(
        "border border-[var(--border)] bg-[var(--surface)] p-6 transition-colors duration-150 hover:border-[var(--border-secondary)]",
        className,
      )}
      {...props}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {icon && <span className="text-[var(--foreground-muted)]">{icon}</span>}
            <p className="text-xs uppercase tracking-wider text-[var(--foreground-secondary)]">
              {label}
            </p>
          </div>
          <p
            className="mt-2 text-2xl font-semibold text-[var(--foreground)] font-mono"
            data-manifest-figure
          >
            {value}
          </p>
        </div>
        {trend && (
          <div
            className={cn(
              "flex items-center gap-1 border px-2 py-1 text-xs font-medium font-mono",
              trend.direction === "up"
                ? "border-[var(--clearance-teal)]/30 bg-[var(--clearance-teal)]/10 text-[var(--clearance-teal)]"
                : "border-[var(--brand-red)]/30 bg-[var(--brand-red)]/10 text-[var(--brand-red)]",
            )}
            data-manifest-figure
          >
            {trend.direction === "up" ? (
              <TrendingUp className="h-3 w-3" />
            ) : (
              <TrendingDown className="h-3 w-3" />
            )}
            <span>{trend.value}%</span>
          </div>
        )}
      </div>
      {(description ?? trend?.label) && (
        <p className="mt-2 text-xs text-[var(--foreground-muted)]">{description ?? trend?.label}</p>
      )}
    </div>
  );
}
