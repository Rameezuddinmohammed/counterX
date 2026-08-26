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
import { Search, Bell, User, Settings, LogOut } from "lucide-react";
import type { BreadcrumbItem } from "@counter/ui";

const ROUTE_LABELS: Record<string, string> = {
  "/": "Dashboard",
  "/transactions": "Transactions",
  "/approvals": "Approvals",
  "/mandates": "Mandates",
  "/devices": "Devices",
  "/triggers": "Triggers",
  "/policy": "Policy",
  "/security": "Security",
  "/enrollment": "Enrollment",
  "/references": "References",
  "/export": "Export",
  "/settings": "Settings",
  "/profile": "Profile",
};

interface TopBarProps {
  onCommandPaletteOpen: () => void;
}

export function TopBar({ onCommandPaletteOpen }: TopBarProps) {
  const pathname = usePathname();

  const breadcrumbs: BreadcrumbItem[] = [
    { label: "Wallet", href: "/" },
  ];

  if (pathname !== "/") {
    const label = ROUTE_LABELS[pathname] ?? pathname.slice(1);
    breadcrumbs.push({ label, href: pathname });
  }

  return (
    <header className="flex h-14 items-center justify-between border-b border-[var(--border)] bg-[var(--surface)] px-6">
      <Breadcrumbs items={breadcrumbs} />

      <div className="flex items-center gap-2">
        {/* Command Palette Trigger */}
        <button
          onClick={onCommandPaletteOpen}
          className="flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm text-[var(--foreground-muted)] hover:border-[var(--border-secondary)] hover:text-[var(--foreground)] transition-colors"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Search...</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded border border-[var(--border)] px-1.5 py-0.5 text-[10px] font-medium text-[var(--foreground-muted)]">
            &#8984;K
          </kbd>
        </button>

        {/* Theme Toggle */}
        <ThemeToggle />

        {/* Notifications */}
        <button className="relative rounded-lg p-2 text-[var(--foreground-muted)] hover:bg-[var(--surface-secondary)] hover:text-[var(--foreground)] transition-colors">
          <Bell className="h-4 w-4" />
        </button>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-lg p-1 hover:bg-[var(--surface-secondary)] transition-colors">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-[var(--brand-orange)]/20 text-[var(--brand-orange)] text-xs">
                  WC
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
            <Link href="/settings">
              <DropdownMenuItem>
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
            </Link>
            <DropdownMenuSeparator />
            <a href="/api/auth/logout">
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
