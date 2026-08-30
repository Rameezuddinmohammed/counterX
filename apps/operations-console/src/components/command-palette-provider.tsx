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
  Server,
  AlertTriangle,
  ListOrdered,
  Power,
  Headphones,
  Plug,
  Settings,
  Moon,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";

const NAV_COMMANDS = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Fleet Health", href: "/fleet", icon: Server },
  { label: "Incidents", href: "/incidents", icon: AlertTriangle },
  { label: "Queues", href: "/queues", icon: ListOrdered },
  { label: "Kill Switches", href: "/kill-switches", icon: Power },
  { label: "Support", href: "/support", icon: Headphones },
  { label: "Adapters", href: "/adapters", icon: Plug },
  { label: "Settings", href: "/settings", icon: Settings },
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
        <CommandInput placeholder="Search operations..." />
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
              <span>Switch to {theme === "dark" ? "Light" : "Dark"} Mode</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandPalette>
    </>
  );
}
