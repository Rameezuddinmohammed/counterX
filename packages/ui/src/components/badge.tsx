import * as React from "react";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

const badgeVariants = cva(
  "inline-flex items-center rounded-none border px-2.5 py-0.5 text-xs font-medium transition-colors focus:outline-none focus:ring-2 focus:ring-[var(--ring)] focus:ring-offset-2",
  {
    variants: {
      variant: {
        default: "border-transparent bg-[var(--brand-red)] text-white",
        secondary:
          "border-[var(--border)] bg-[var(--surface-secondary)] text-[var(--foreground-secondary)]",
        success: "border-transparent bg-[var(--clearance-teal)]/15 text-[var(--clearance-teal)]",
        warning: "border-transparent bg-[var(--manifest-ochre)]/15 text-[var(--manifest-ochre)]",
        error: "border-transparent bg-[var(--brand-red)]/15 text-[var(--brand-red)]",
        info: "border-transparent bg-[var(--clearance-teal)]/15 text-[var(--clearance-teal)]",
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
