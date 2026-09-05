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
import { Settings } from "lucide-react";
import { NAV_SECTIONS } from "@/lib/nav-config";

export function AppSidebar() {
  const pathname = usePathname();
  const { collapsed } = useSidebar();

  return (
    <Sidebar>
      <SidebarHeader>
        <Link href="/" className="flex items-center gap-2 no-underline">
          <CounterLogo size={26} className="text-[var(--foreground)]" />
          {!collapsed && <CounterWordmark size={22} className="text-[var(--foreground)]" />}
        </Link>
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
            <AvatarFallback
              className="bg-[var(--brand-red)]/15 text-[var(--brand-red)] text-xs font-mono"
              data-manifest-figure
            >
              MC
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--foreground)] truncate">Merchant</p>
              <p className="text-xs text-[var(--foreground-muted)] truncate">Test mode</p>
            </div>
          )}
          {!collapsed && (
            <Link
              href="/profile"
              className="text-[var(--foreground-muted)] hover:text-[var(--foreground)]"
              aria-label="Profile and settings"
            >
              <Settings className="h-4 w-4" />
            </Link>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
