import * as React from "react";
import { Slot } from "@radix-ui/react-slot";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "../lib/utils.js";

const buttonVariants = cva(
  "inline-flex items-center justify-center gap-2 whitespace-nowrap rounded-lg text-sm font-medium transition-all duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-offset-2 focus-visible:ring-offset-[var(--background)] disabled:pointer-events-none disabled:opacity-50 [&_svg]:pointer-events-none [&_svg]:size-4 [&_svg]:shrink-0 cursor-pointer",
  {
    variants: {
      variant: {
        default:
          "bg-[var(--brand-orange)] text-white shadow-md hover:bg-[var(--brand-orange-dark)] hover:shadow-lg active:scale-[0.98]",
        outline:
          "border border-[var(--border)] bg-transparent text-[var(--foreground)] hover:bg-[var(--surface-secondary)] hover:border-[var(--border-secondary)]",
        ghost:
          "text-[var(--foreground-secondary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--foreground)]",
        destructive:
          "bg-[var(--error)] text-white shadow-md hover:bg-red-600 active:scale-[0.98]",
        link:
          "text-[var(--brand-orange)] underline-offset-4 hover:underline p-0 h-auto",
        secondary:
          "bg-[var(--surface-secondary)] text-[var(--foreground)] border border-[var(--border)] hover:bg-[var(--border)] active:scale-[0.98]",
      },
      size: {
        default: "h-10 px-4 py-2",
        sm: "h-8 rounded-md px-3 text-xs",
        lg: "h-12 rounded-lg px-6 text-base",
        icon: "h-10 w-10",
      },
    },
    defaultVariants: {
      variant: "default",
      size: "default",
    },
  }
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
      <Comp
        className={cn(buttonVariants({ variant, size, className }))}
        ref={ref}
        {...props}
      />
    );
  }
);
Button.displayName = "Button";

export { Button, buttonVariants };
