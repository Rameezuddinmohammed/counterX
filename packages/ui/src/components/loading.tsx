import * as React from "react";
import { cn } from "../lib/utils";

export interface SpinnerProps extends React.HTMLAttributes<HTMLDivElement> {
  size?: "sm" | "md" | "lg";
}

export function Spinner({ size = "md", className, ...props }: SpinnerProps) {
  const sizeClasses = {
    sm: "h-4 w-4 border-2",
    md: "h-6 w-6 border-2",
    lg: "h-8 w-8 border-[3px]",
  };

  return (
    <div
      className={cn(
        "animate-spin rounded-full border-[var(--brand-orange)] border-t-transparent",
        sizeClasses[size],
        className,
      )}
      role="status"
      aria-label="Loading"
      {...props}
    >
      <span className="sr-only">Loading...</span>
    </div>
  );
}

export type SkeletonProps = React.HTMLAttributes<HTMLDivElement>;

export function Skeleton({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn("animate-pulse rounded-lg bg-[var(--surface-secondary)]", className)}
      {...props}
    />
  );
}

export function SkeletonText({
  className,
  lines = 3,
  ...props
}: SkeletonProps & { lines?: number }) {
  return (
    <div className={cn("space-y-2", className)} {...props}>
      {Array.from({ length: lines }).map((_, i) => (
        <Skeleton key={i} className={cn("h-4", i === lines - 1 ? "w-3/4" : "w-full")} />
      ))}
    </div>
  );
}

export function SkeletonCard({ className, ...props }: SkeletonProps) {
  return (
    <div
      className={cn(
        "rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 space-y-4",
        className,
      )}
      {...props}
    >
      <Skeleton className="h-5 w-1/3" />
      <SkeletonText lines={2} />
      <Skeleton className="h-10 w-full" />
    </div>
  );
}

export interface LoadingOverlayProps extends React.HTMLAttributes<HTMLDivElement> {
  message?: string;
}

export function LoadingOverlay({
  message = "Loading...",
  className,
  ...props
}: LoadingOverlayProps) {
  return (
    <div
      className={cn("flex flex-col items-center justify-center gap-3 p-8", className)}
      {...props}
    >
      <Spinner size="lg" />
      <p className="text-sm text-[var(--foreground-secondary)]">{message}</p>
    </div>
  );
}
