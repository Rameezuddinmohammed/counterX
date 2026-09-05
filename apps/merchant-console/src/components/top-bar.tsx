"use client";

import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Breadcrumbs,
  ThemeToggle,
  Avatar,
  AvatarFallback,
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@counter/ui";
import { Search, User, LogOut } from "lucide-react";
import type { BreadcrumbItem } from "@counter/ui";
import { ROUTE_LABELS } from "@/lib/nav-config";

interface TopBarProps {
  onCommandPaletteOpen: () => void;
}

export function TopBar({ onCommandPaletteOpen }: TopBarProps) {
  const pathname = usePathname();

  const breadcrumbs: BreadcrumbItem[] = [{ label: "Console", href: "/" }];

  if (pathname !== "/") {
    const label = ROUTE_LABELS[pathname] ?? pathname.slice(1);
    breadcrumbs.push({ label, href: pathname });
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6">
      <Breadcrumbs items={breadcrumbs} />

      <div className="flex items-center gap-2">
        <button
          onClick={onCommandPaletteOpen}
          className="flex items-center gap-2 border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--foreground-muted)] hover:border-[var(--border-secondary)] hover:text-[var(--foreground)] transition-colors"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Search...</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-mono font-medium text-[var(--foreground-muted)]">
            &#8984;K
          </kbd>
        </button>

        <ThemeToggle />

        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 p-1 hover:bg-[var(--surface-secondary)] transition-colors">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-[var(--brand-red)]/15 text-[var(--brand-red)] text-xs font-mono" data-manifest-figure>
                  MC
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-48">
            <Link href="/profile">
              <DropdownMenuItem>
                <User className="mr-2 h-4 w-4" />
                Profile
              </DropdownMenuItem>
            </Link>
            <DropdownMenuSeparator />
            <a href="/auth/logout">
              <DropdownMenuItem>
                <LogOut className="mr-2 h-4 w-4" />
                Logout
              </DropdownMenuItem>
            </a>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>
    </header>
  );
}
