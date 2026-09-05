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
        "rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5 shadow-sm transition-all duration-200 hover:border-[var(--border-secondary)]",
        className,
      )}
      {...props}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2.5">
            {icon && (
              <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-600 dark:bg-indigo-500/15 dark:text-indigo-400">
                {icon}
              </div>
            )}
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-secondary)]">
              {label}
            </p>
          </div>
          <p
            className="mt-3 text-2xl font-bold font-mono tracking-tight text-[var(--foreground)]"
            data-manifest-figure
          >
            {value}
          </p>
        </div>
        {trend && (
          <div
            className={cn(
              "flex items-center gap-1 rounded-full border px-2 py-0.5 text-xs font-semibold font-mono",
              trend.direction === "up"
                ? "border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400"
                : "border-rose-500/30 bg-rose-500/15 text-rose-600 dark:text-rose-400",
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
