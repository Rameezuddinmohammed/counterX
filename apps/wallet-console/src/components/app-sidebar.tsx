"use client";

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
} from "lucide-react";

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

export function AppSidebar() {
  const pathname = usePathname();
  const { collapsed } = useSidebar();

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
              <p className="text-xs font-medium text-[var(--foreground)] truncate">wlt-pilot-001</p>
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
              WC
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--foreground)] truncate">Wallet User</p>
              <p className="text-xs text-[var(--foreground-muted)] truncate">Pilot Mode</p>
            </div>
          )}
          {!collapsed && (
            <Link
              href="/settings"
              className="text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
            >
              <Settings className="h-4 w-4" />
            </Link>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
