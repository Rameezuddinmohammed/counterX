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
  ShoppingBag,
  ArrowLeftRight,
  FileText,
  CreditCard,
  Receipt,
  Shield,
  Power,
  AlertOctagon,
  ClipboardList,
  Search,
  UserPlus,
  Activity,
  Settings,
} from "lucide-react";

const NAV_SECTIONS = [
  {
    title: "Overview",
    items: [
      { href: "/", label: "Dashboard", icon: LayoutDashboard },
    ],
  },
  {
    title: "Commerce",
    items: [
      { href: "/shopify", label: "Shopify", icon: ShoppingBag },
      { href: "/mapping", label: "Mapping", icon: ArrowLeftRight },
      { href: "/manifest", label: "Manifest", icon: FileText },
    ],
  },
  {
    title: "Payments",
    items: [
      { href: "/razorpay", label: "Razorpay", icon: CreditCard },
      { href: "/transactions", label: "Transactions", icon: Receipt },
    ],
  },
  {
    title: "Security",
    items: [
      { href: "/policy", label: "Policy", icon: Shield },
      { href: "/killswitch", label: "Kill Switches", icon: Power },
      { href: "/suspension", label: "Suspension", icon: AlertOctagon },
    ],
  },
  {
    title: "Admin",
    items: [
      { href: "/audit", label: "Audit", icon: ClipboardList },
      { href: "/findings", label: "Findings", icon: Search },
      { href: "/invite", label: "Invite", icon: UserPlus },
      { href: "/readiness", label: "Readiness", icon: Activity },
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
        {NAV_SECTIONS.map((section) => (
          <SidebarSection key={section.title} title={section.title}>
            {section.items.map((item) => (
              <Link key={item.href} href={item.href} className="no-underline">
                <SidebarItem
                  icon={<item.icon className="h-4 w-4" />}
                  active={
                    item.href === "/"
                      ? pathname === "/"
                      : pathname.startsWith(item.href)
                  }
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
              MC
            </AvatarFallback>
          </Avatar>
          {!collapsed && (
            <div className="flex-1 min-w-0">
              <p className="text-sm font-medium text-[var(--foreground)] truncate">
                Merchant
              </p>
              <p className="text-xs text-[var(--foreground-muted)] truncate">
                Pilot Mode
              </p>
            </div>
          )}
          {!collapsed && (
            <Link href="/settings" className="text-[var(--foreground-muted)] hover:text-[var(--foreground)]">
              <Settings className="h-4 w-4" />
            </Link>
          )}
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
