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
import { ShoppingBag, Settings } from "lucide-react";
import { NAV_SECTIONS } from "@/lib/nav-config";
import type { SessionIdentity } from "@/app/api/session/route";

export function AppSidebar() {
  const pathname = usePathname();
  const { collapsed } = useSidebar();
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

  const displayName = session?.name ?? session?.email ?? "Merchant";
  const initials = (session?.name
    ? session.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
    : (session?.email?.slice(0, 2) ?? "MC")
  ).toUpperCase();

  return (
    <Sidebar>
      <SidebarHeader>
        <Link href="/" className="flex items-center gap-2.5 no-underline">
          <CounterLogo size={24} className="text-[var(--foreground)]" />
          {!collapsed && <CounterWordmark size={20} className="text-[var(--foreground)]" />}
        </Link>
        <SidebarToggle />
      </SidebarHeader>

      <SidebarContent>
        {/* Store Identity Badge */}
        {!collapsed && (
          <div className="mb-2 flex items-center gap-2.5 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2.5 shadow-xs">
            <div className="flex h-8 w-8 shrink-0 items-center justify-center rounded-lg bg-indigo-500/10 text-indigo-500">
              <ShoppingBag className="h-4 w-4" />
            </div>
            <div className="flex-1 min-w-0">
              <p className="truncate text-xs font-medium text-[var(--foreground)]">
                Merchant Store
              </p>
              <div className="mt-0.5 flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                <span className="text-[10px] text-[var(--foreground-muted)]">Live Sandbox</span>
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
            {session?.picture ? (
              <img
                src={session.picture}
                alt={displayName}
                className="h-full w-full rounded-full object-cover"
              />
            ) : (
              <AvatarFallback className="bg-indigo-500/20 text-indigo-400 text-xs font-bold font-mono">
                {initials}
              </AvatarFallback>
            )}
          </Avatar>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="truncate text-xs font-semibold text-[var(--foreground)]">
                {displayName}
              </p>
              <p className="truncate text-[11px] text-[var(--foreground-muted)]">
                {session?.merchantId ? "Live Merchant" : "Sandbox"}
              </p>
            </div>
          )}
          {!collapsed && (
            <Link
              href="/profile"
              className="rounded-lg p-1.5 text-[var(--foreground-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] transition-colors"
              aria-label="Profile and settings"
              title="Store Settings"
            >
              <Settings className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
