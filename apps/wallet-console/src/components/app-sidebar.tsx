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
  Badge,
  useSidebar,
} from "@counter/ui";
import {
  LayoutDashboard,
  ArrowLeftRight,
  CheckCircle2,
  FileText,
  Smartphone,
  Zap,
  Shield,
  Lock,
  UserCheck,
  BookOpen,
  Download,
  Settings,
  Wallet,
  LogOut,
} from "lucide-react";

const LANDING_URL = process.env["NEXT_PUBLIC_LANDING_URL"] ?? "https://counter-landing-blond.vercel.app";

const NAV_SECTIONS = [
  {
    title: "Overview",
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    title: "Activity",
    items: [
      { href: "/transactions", label: "Transactions", icon: ArrowLeftRight },
      { href: "/approvals", label: "Approvals", icon: CheckCircle2 },
      { href: "/mandates", label: "Mandates", icon: FileText },
      { href: "/wallet/topup", label: "Add Funds", icon: Wallet },
    ],
  },
  {
    title: "Devices & Automation",
    items: [
      { href: "/devices", label: "Devices", icon: Smartphone },
      { href: "/triggers", label: "Triggers", icon: Zap },
    ],
  },
  {
    title: "Governance",
    items: [
      { href: "/policy", label: "Policy", icon: Shield },
      { href: "/security", label: "Security", icon: Lock },
      { href: "/enrollment", label: "Enrollment", icon: UserCheck },
    ],
  },
  {
    title: "Data",
    items: [
      { href: "/references", label: "References", icon: BookOpen },
      { href: "/export", label: "Export", icon: Download },
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
        <Link href="/" className="flex items-center gap-2 no-underline">
          <CounterLogo size={28} />
          {!collapsed && <CounterWordmark className="h-5" />}
        </Link>
        <div className="ml-auto">
          <SidebarToggle />
        </div>
      </SidebarHeader>

      <SidebarContent>
        {/* Wallet Status Indicator */}
        {!collapsed && (
          <div className="mx-3 mb-2 flex items-center gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-secondary)] px-3 py-2">
            <Wallet className="h-4 w-4 text-[var(--brand-orange)]" />
            <div className="flex-1 min-w-0">
              <p className="text-xs font-medium text-[var(--foreground)] truncate">
                {identity?.walletId ?? "…"}
              </p>
              <div className="flex items-center gap-1.5">
                <span className="h-1.5 w-1.5 rounded-full bg-green-500" />
                <span className="text-[10px] text-[var(--foreground-muted)]">Active</span>
              </div>
            </div>
            <Badge variant="secondary" className="text-[10px]">
              Pilot
            </Badge>
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
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-[var(--brand-orange)]/20 text-[var(--brand-orange)] text-xs">
              {initials}
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--foreground)] truncate">
                {displayName}
              </p>
              <p className="text-xs text-[var(--foreground-muted)] truncate">Pilot Mode</p>
            </div>
          )}
          {!collapsed && (
            <a
              href={`${LANDING_URL}/docs`}
              target="_blank"
              rel="noreferrer"
              className="text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
              title="Docs"
            >
              <BookOpen className="h-4 w-4" />
            </a>
          )}
          {!collapsed && (
            <Link
              href="/settings"
              className="text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
            >
              <Settings className="h-4 w-4" />
            </Link>
          )}
          {!collapsed && (
            <a
              href="/auth/logout"
              className="text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
              title="Log out"
            >
              <LogOut className="h-4 w-4" />
            </a>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
