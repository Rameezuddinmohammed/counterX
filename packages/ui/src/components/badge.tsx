import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-full border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[var(--brand-orange)] text-white",
        secondary:
          "border-[var(--border)] bg-[var(--surface-secondary)] text-[var(--foreground-secondary)]",
        success: "border-transparent bg-emerald-500/15 text-emerald-500",
        warning: "border-transparent bg-amber-500/15 text-amber-600",
        error: "border-transparent bg-red-500/15 text-red-600",
        info: "border-transparent bg-blue-500/15 text-blue-600",
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
