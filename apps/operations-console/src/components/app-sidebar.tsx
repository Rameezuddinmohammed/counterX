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
  useSidebar,
} from "@counter/ui";
import {
  LayoutDashboard,
  Server,
  AlertTriangle,
  ListOrdered,
  Power,
  Headphones,
  Plug,
  Settings,
} from "lucide-react";

const NAV_SECTIONS = [
  {
    title: "Overview",
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    title: "Platform",
    items: [
      { href: "/fleet", label: "Fleet Health", icon: Server },
      { href: "/incidents", label: "Incidents", icon: AlertTriangle },
      { href: "/queues", label: "Queues", icon: ListOrdered },
    ],
  },
  {
    title: "Controls",
    items: [
      { href: "/kill-switches", label: "Kill Switches", icon: Power },
      { href: "/support", label: "Support", icon: Headphones },
      { href: "/adapters", label: "Adapters", icon: Plug },
    ],
  },
] as const;

export function AppSidebar() {
  const pathname = usePathname();
  const { collapsed } = useSidebar();

  return (
    <Sidebar>
      <SidebarHeader>
        <div className="flex items-center gap-2.5">
          <Link href="/" className="flex items-center gap-2.5 no-underline">
            <CounterLogo size={24} />
            {!collapsed && <CounterWordmark className="h-4.5" />}
          </Link>
          {!collapsed && (
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
            </span>
          )}
        </div>
        <SidebarToggle />
      </SidebarHeader>

      <SidebarContent>
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
              OP
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="truncate text-xs font-semibold text-[var(--foreground)]">Operator</p>
              <p className="truncate text-[11px] text-[var(--foreground-muted)]">Platform Admin</p>
            </div>
          )}
          {!collapsed && (
            <Link
              href="/settings"
              className="rounded-lg p-1.5 text-[var(--foreground-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] transition-colors"
              title="Settings"
            >
              <Settings className="h-3.5 w-3.5" />
            </Link>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
