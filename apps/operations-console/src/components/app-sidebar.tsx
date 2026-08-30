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
        <Link href="/" className="flex items-center gap-2 no-underline">
          <CounterLogo size={28} />
          {!collapsed && <CounterWordmark className="h-5" />}
        </Link>
        {!collapsed && (
          <div className="ml-2 flex items-center gap-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-green-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-green-500" />
            </span>
          </div>
        )}
        <div className="ml-auto">
          <SidebarToggle />
        </div>
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
        <div className="flex items-center gap-3">
          <Avatar className="h-8 w-8">
            <AvatarFallback className="bg-[var(--brand-orange)]/20 text-[var(--brand-orange)] text-xs">
              OP
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--foreground)] truncate">Operator</p>
              <p className="text-xs text-[var(--foreground-muted)] truncate">Platform Admin</p>
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
