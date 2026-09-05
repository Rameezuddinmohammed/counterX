import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils";

// "The Manifest" direction (.impeccable/surfaces/apps-landing.md, seed
// 4c02ca8d): rectangular, ruled — a manifest disposition stamp, not a
// rounded SaaS pill. No border-radius, no active:scale bounce (a stamp
// lands flat, it doesn't squash); hover deepens the seal color instead.
const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-none text-sm font-medium tracking-tight transition-colors duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer",
  {
    variants: {
      variant: {
        default: "bg-[var(--brand-red)] text-[#fbf9f4] hover:bg-[var(--brand-red-dark)]",
        outline:
          "border border-[var(--border)] bg-transparent text-[var(--foreground)] hover:bg-[var(--surface-secondary)] hover:border-[var(--border-secondary)]",
        ghost:
          "text-[var(--foreground-secondary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--foreground)]",
        destructive: "bg-[var(--error)] text-[#fbf9f4] hover:bg-[var(--brand-red-dark)]",
        link: "text-[var(--brand-red)] underline-offset-4 hover:underline p-0 h-auto",
        secondary:
          "bg-[var(--surface-secondary)] text-[var(--foreground)] border border-[var(--border)] hover:bg-[var(--border)]",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 px-3 text-xs",
        lg: "h-12 px-6 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  },
);

export interface ButtonProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement>,
    VariantProps<typeof buttonVariants> {
  asChild?: boolean;
}

const Button = React.forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className, variant, size, asChild = false, ...props }, ref) => {
    const Comp = asChild ? Slot : "button";
    return (
      <Comp className={cn(buttonVariants({ variant, size, className }))} ref={ref} {...props} />
    );
  },
);
Button.displayName = "Button";

export { Button, buttonVariants };
