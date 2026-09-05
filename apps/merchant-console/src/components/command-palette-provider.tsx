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
import { User, Moon, Sun } from "lucide-react";
import { useTheme } from "next-themes";
import { NAV_ITEMS } from "@/lib/nav-config";

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
            {NAV_ITEMS.map((cmd) => (
              <CommandItem key={cmd.href} onSelect={() => handleNavigate(cmd.href)}>
                <cmd.icon className="mr-2 h-4 w-4" />
                <span>{cmd.label}</span>
              </CommandItem>
            ))}
            <CommandItem onSelect={() => handleNavigate("/profile")}>
              <User className="mr-2 h-4 w-4" />
              <span>Profile</span>
            </CommandItem>
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
