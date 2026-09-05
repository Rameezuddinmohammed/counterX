import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center gap-1 rounded-full border px-2.5 py-0.5 text-[11px] font-semibold tracking-wide transition-all focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-indigo-500/30 bg-indigo-500/15 text-indigo-600 dark:text-indigo-400",
        secondary:
          "border-[var(--border)] bg-[var(--surface-secondary)] text-[var(--foreground-secondary)]",
        success: "border-emerald-500/30 bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
        warning: "border-amber-500/30 bg-amber-500/15 text-amber-600 dark:text-amber-400",
        error: "border-rose-500/30 bg-rose-500/15 text-rose-600 dark:text-rose-400",
        info: "border-cyan-500/30 bg-cyan-500/15 text-cyan-600 dark:text-cyan-400",
        outline: "border-[var(--border)] text-[var(--foreground-secondary)]",
      },
    },
    defaultVariants: {
      variant: "default",
    },
  },
);

export interface BadgeProps
  extends React.HTMLAttributes<HTMLDivElement>,
    VariantProps<typeof badgeVariants> {}

function Badge({ className, variant, ...props }: BadgeProps) {
  return <div className={cn(badgeVariants({ variant }), className)} {...props} />;
}

export { Badge, badgeVariants };
