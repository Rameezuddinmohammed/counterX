"use client";

import { useCallback, useEffect } from "react";
import { useRouter } from "next/navigation";
import {
  CommandPalette,
  CommandInput,
  CommandList,
  CommandEmpty,
  CommandGroup,
  CommandItem,
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
  User,
  Moon,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";

const NAV_COMMANDS = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Shopify", href: "/shopify", icon: ShoppingBag },
  { label: "Mapping", href: "/mapping", icon: ArrowLeftRight },
  { label: "Manifest", href: "/manifest", icon: FileText },
  { label: "Razorpay", href: "/razorpay", icon: CreditCard },
  { label: "Transactions", href: "/transactions", icon: Receipt },
  { label: "Policy", href: "/policy", icon: Shield },
  { label: "Kill Switches", href: "/killswitch", icon: Power },
  { label: "Suspension", href: "/suspension", icon: AlertOctagon },
  { label: "Audit", href: "/audit", icon: ClipboardList },
  { label: "Findings", href: "/findings", icon: Search },
  { label: "Invite", href: "/invite", icon: UserPlus },
  { label: "Readiness", href: "/readiness", icon: Activity },
  { label: "Settings", href: "/settings", icon: Settings },
  { label: "Profile", href: "/profile", icon: User },
];

interface CommandPaletteProviderProps {
  children: React.ReactNode;
  open: boolean;
  onOpenChange: (open: boolean) => void;
}

export function CommandPaletteProvider({
  children,
  open,
  onOpenChange,
}: CommandPaletteProviderProps) {
  const router = useRouter();
  const { setTheme, theme } = useTheme();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === "k") {
        e.preventDefault();
        onOpenChange(!open);
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => document.removeEventListener("keydown", handleKeyDown);
  }, [open, onOpenChange]);

  const handleNavigate = useCallback(
    (href: string) => {
      router.push(href);
      onOpenChange(false);
    },
    [router, onOpenChange],
  );

  const handleToggleTheme = useCallback(() => {
    setTheme(theme === "dark" ? "light" : "dark");
    onOpenChange(false);
  }, [setTheme, theme, onOpenChange]);

  return (
    <>
      {children}
      <CommandPalette open={open} onOpenChange={onOpenChange}>
        <CommandInput placeholder="Type a command or search..." />
        <CommandList>
          <CommandEmpty>No results found.</CommandEmpty>
          <CommandGroup heading="Navigation">
            {NAV_COMMANDS.map((cmd) => (
              <CommandItem key={cmd.href} onSelect={() => handleNavigate(cmd.href)}>
                <cmd.icon className="mr-2 h-4 w-4" />
                <span>{cmd.label}</span>
              </CommandItem>
            ))}
          </CommandGroup>
          <CommandGroup heading="Actions">
            <CommandItem onSelect={handleToggleTheme}>
              {theme === "dark" ? (
                <Sun className="mr-2 h-4 w-4" />
              ) : (
                <Moon className="mr-2 h-4 w-4" />
              )}
              <span>Toggle Theme</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandPalette>
    </>
  );
}
