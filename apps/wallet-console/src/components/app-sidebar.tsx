"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import {
  Sidebar,
  SidebarHeader,
  SidebarContent,
  SidebarSection,
  SidebarItem,
  SidebarFooter,
  SidebarToggle,
  CounterLogo,
  CounterWordmark,
  Avatar,
  AvatarFallback,
  useSidebar,
} from "@counter/ui";
import {
  LayoutDashboard,
  ArrowLeftRight,
  FileText,
  Smartphone,
  Zap,
  Shield,
  Download,
  Settings,
  Wallet,
  LogOut,
  KeyRound,
  BookOpen,
} from "lucide-react";

const LANDING_URL =
  process.env["NEXT_PUBLIC_LANDING_URL"] ?? "https://counter-landing-blond.vercel.app";

const NAV_SECTIONS = [
  {
    title: "Treasury & Limits",
    items: [
      { href: "/", label: "Overview", icon: LayoutDashboard },
      { href: "/mandates", label: "Mandates & Keys", icon: FileText },
      { href: "/connect", label: "Authorize Agent", icon: KeyRound },
      { href: "/wallet/topup", label: "Add Funds", icon: Wallet },
    ],
  },
  {
    title: "Activity",
    items: [
      { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
    ],
  },
  {
    title: "Labs & Extensions",
    items: [
      { href: "/devices", label: "Devices", icon: Smartphone },
      { href: "/triggers", label: "Triggers", icon: Zap },
      { href: "/policy", label: "Governance", icon: Shield },
      { href: "/export", label: "Export Records", icon: Download },
    ],
  },
] as const;

interface SessionIdentity {
  readonly walletId?: string;
  readonly email?: string | null;
  readonly name?: string | null;
}

export function AppSidebar() {
  const pathname = usePathname();
  const { collapsed } = useSidebar();
  const [identity, setIdentity] = useState<SessionIdentity | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const response = await fetch("/api/session");
        if (!response.ok) return;
        const body = (await response.json()) as SessionIdentity;
        if (!cancelled) setIdentity(body);
      } catch {
        // Sidebar falls back to a loading placeholder — non-fatal.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const displayName = identity?.name ?? identity?.email ?? "Wallet User";
  const initials = displayName.slice(0, 2).toUpperCase();

  return (
    <Sidebar>
      <SidebarHeader>
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          <CounterLogo size={24} />
          {!collapsed && <CounterWordmark className="h-4.5" />}
        </Link>
        <SidebarToggle />
      </SidebarHeader>

      <SidebarContent>
        {/* Wallet Status Indicator */}
        {!collapsed && (
          <div className="mb-2 flex items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5 shadow-xs">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
              <Wallet className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate font-mono text-xs font-medium text-[var(--foreground)]">
                {identity?.walletId ?? "Loading..."}
              </p>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] text-[var(--foreground-muted)]">Verified Pilot</span>
              </div>
            </div>
          </div>
        )}

        {NAV_SECTIONS.map((section) => (
          <SidebarSection key={section.title} title={section.title}>
            {section.items.map((item) => (
              <Link key={item.href} href={item.href} className="no-underline">
                <SidebarItem
                  icon={<item.icon className="h-4 w-4" />}
                  active={item.href === "/" ? pathname === "/" : pathname.startsWith(item.href)}
                >
                  {item.label}
                </SidebarItem>
              </Link>
            ))}
          </SidebarSection>
        ))}
      </SidebarContent>

      <SidebarFooter>
        <div className="flex items-center gap-2.5">
          <Avatar className="h-8 w-8 shrink-0">
            <AvatarFallback className="bg-indigo-500/20 text-indigo-400 text-xs font-bold font-mono">
              {initials}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="truncate text-xs font-semibold text-[var(--foreground)]">{displayName}</p>
              <p className="truncate text-[11px] text-[var(--foreground-muted)]">Pilot Mode</p>
            </div>
          )}
          {!collapsed && (
            <div className="flex shrink-0 items-center gap-1">
              <a
                href={`${LANDING_URL}/docs`}
                target="_blank"
                rel="noreferrer"
                className="rounded-lg p-1.5 text-[var(--foreground-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] transition-colors"
                title="Documentation"
              >
                <BookOpen className="h-3.5 w-3.5" />
              </a>
              <Link
                href="/settings"
                className="rounded-lg p-1.5 text-[var(--foreground-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] transition-colors"
                title="Settings"
              >
                <Settings className="h-3.5 w-3.5" />
              </Link>
              <a
                href="/auth/logout"
                className="rounded-lg p-1.5 text-[var(--foreground-muted)] hover:bg-rose-500/10 hover:text-rose-400 transition-colors"
                title="Sign out"
              >
                <LogOut className="h-3.5 w-3.5" />
              </a>
            </div>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
