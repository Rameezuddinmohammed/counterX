import {
  LayoutDashboard,
  ShoppingBag,
  UserPlus,
  Landmark,
  Receipt,
  ShieldCheck,
  Power,
  type LucideIcon,
} from "lucide-react";

/**
 * Single source of truth for merchant-console navigation — sidebar,
 * top-bar breadcrumbs, and the command palette all derive from this list
 * rather than maintaining three independent copies.
 */
export interface NavItem {
  readonly href: string;
  readonly label: string;
  readonly icon: LucideIcon;
}

export interface NavSection {
  readonly title: string;
  readonly items: readonly NavItem[];
}

export const NAV_SECTIONS: readonly NavSection[] = [
  {
    title: "Overview",
    items: [{ href: "/", label: "Dashboard", icon: LayoutDashboard }],
  },
  {
    title: "Commerce",
    items: [
      { href: "/shopify", label: "Shopify", icon: ShoppingBag },
      { href: "/invite", label: "Onboarding", icon: UserPlus },
    ],
  },
  {
    title: "Payments",
    items: [
      { href: "/razorpay", label: "Settlement account", icon: Landmark },
      { href: "/transactions", label: "Transactions", icon: Receipt },
    ],
  },
  {
    title: "Controls",
    items: [
      { href: "/policy", label: "Selling policy", icon: ShieldCheck },
      { href: "/killswitch", label: "Kill switch", icon: Power },
    ],
  },
];

/** Flat lookup used by the top-bar breadcrumb and command palette. */
export const NAV_ITEMS: readonly NavItem[] = NAV_SECTIONS.flatMap((section) => section.items);

export const ROUTE_LABELS: Record<string, string> = {
  ...Object.fromEntries(NAV_ITEMS.map((item) => [item.href, item.label])),
  "/profile": "Profile",
};
