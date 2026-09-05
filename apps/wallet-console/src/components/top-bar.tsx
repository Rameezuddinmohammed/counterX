"use client";

import { useEffect, useState } from "react";
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

interface SessionIdentity {
  readonly walletId?: string;
  readonly email?: string | null;
  readonly name?: string | null;
}

interface TopBarProps {
  onCommandPaletteOpen: () => void;
}

export function TopBar({ onCommandPaletteOpen }: TopBarProps) {
  const pathname = usePathname();
  const [session, setSession] = useState<SessionIdentity | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/session");
        if (!res.ok) return;
        const data = (await res.json()) as SessionIdentity;
        if (!cancelled) setSession(data);
      } catch {}
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const displayName = session?.name ?? session?.email ?? "Wallet";
  const initials = (session?.name
    ? session.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
    : (session?.email?.slice(0, 2) ?? "WC")
  ).toUpperCase();

  const breadcrumbs: BreadcrumbItem[] = [{ label: "Wallet", href: "/" }];

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
          className="flex items-center gap-2 rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)]/60 px-3 py-1.5 text-xs text-[var(--foreground-muted)] hover:border-[var(--border-secondary)] hover:text-[var(--foreground)] transition-colors shadow-sm"
        >
          <Search className="h-3.5 w-3.5" />
          <span className="hidden sm:inline">Search console...</span>
          <kbd className="hidden sm:inline-flex items-center gap-0.5 rounded-md border border-[var(--border)] bg-[var(--surface)] px-1.5 py-0.5 text-[10px] font-mono font-medium text-[var(--foreground-muted)]">
            &#8984;K
          </kbd>
        </button>

        {/* Theme Toggle */}
        <ThemeToggle />

        {/* Notifications */}
        <button className="relative rounded-xl p-2 text-[var(--foreground-muted)] hover:bg-[var(--surface-secondary)] hover:text-[var(--foreground)] transition-colors">
          <Bell className="h-4 w-4" />
        </button>

        {/* User Menu */}
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button className="flex items-center gap-2 rounded-xl p-1 hover:bg-[var(--surface-secondary)] transition-colors">
              <Avatar className="h-7 w-7">
                <AvatarFallback className="bg-indigo-500/20 text-indigo-400 text-xs font-bold font-mono">
                  {initials}
                </AvatarFallback>
              </Avatar>
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            <div className="px-3 py-2 border-b border-[var(--border)]">
              <p className="text-xs font-semibold text-[var(--foreground)] truncate">
                {displayName}
              </p>
              {session?.email && (
                <p className="text-[11px] text-[var(--foreground-muted)] truncate">
                  {session.email}
                </p>
              )}
            </div>
            <Link href="/profile">
              <DropdownMenuItem className="cursor-pointer">
                <User className="mr-2 h-4 w-4" />
                Profile
              </DropdownMenuItem>
            </Link>
            <Link href="/settings">
              <DropdownMenuItem className="cursor-pointer">
                <Settings className="mr-2 h-4 w-4" />
                Settings
              </DropdownMenuItem>
            </Link>
            <DropdownMenuSeparator />
            <a href="/auth/logout">
              <DropdownMenuItem className="cursor-pointer text-rose-500">
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
