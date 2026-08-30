import * as React from "react";
import { ChevronRight } from "lucide-react";
import { cn } from "../lib/utils";

export interface BreadcrumbItem {
  label: string;
  href?: string;
  active?: boolean;
}

export interface BreadcrumbsProps extends React.HTMLAttributes<HTMLElement> {
  items: BreadcrumbItem[];
  separator?: React.ReactNode;
}

export function Breadcrumbs({ items, separator, className, ...props }: BreadcrumbsProps) {
  return (
    <nav aria-label="Breadcrumb" className={cn("flex items-center", className)} {...props}>
      <ol className="flex items-center gap-1">
        {items.map((item, index) => (
          <li key={index} className="flex items-center gap-1">
            {index > 0 && (
              <span className="text-[var(--foreground-muted)]">
                {separator ?? <ChevronRight className="h-3.5 w-3.5" />}
              </span>
            )}
            {item.href && !item.active ? (
              <a
                href={item.href}
                className="text-sm text-[var(--foreground-secondary)] transition-colors hover:text-[var(--foreground)]"
              >
                {item.label}
              </a>
            ) : (
              <span
                className={cn(
                  "text-sm",
                  item.active
                    ? "font-medium text-[var(--foreground)]"
                    : "text-[var(--foreground-secondary)]",
                )}
              >
                {item.label}
              </span>
            )}
          </li>
        ))}
      </ol>
    </nav>
  );
}
