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
        "rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 transition-all duration-200 hover:border-[var(--border-secondary)]",
        className
      )}
      {...props}
    >
      <div className="flex items-start justify-between">
        <div className="flex-1">
          <div className="flex items-center gap-2">
            {icon && (
              <span className="text-[var(--foreground-muted)]">{icon}</span>
            )}
            <p className="text-sm font-medium text-[var(--foreground-secondary)]">
              {label}
            </p>
          </div>
          <p className="mt-2 text-2xl font-bold text-[var(--foreground)]">
            {value}
          </p>
        </div>
        {trend && (
          <div
            className={cn(
              "flex items-center gap-1 rounded-full px-2 py-1 text-xs font-medium",
              trend.direction === "up"
                ? "bg-emerald-500/10 text-emerald-500"
                : "bg-red-500/10 text-red-500"
            )}
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
        <p className="mt-2 text-xs text-[var(--foreground-muted)]">
          {description ?? trend?.label}
        </p>
      )}
    </div>
  );
}
