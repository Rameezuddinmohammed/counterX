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
  User,
  Moon,
  Sun,
} from "lucide-react";
import { useTheme } from "next-themes";

const NAV_COMMANDS = [
  { label: "Dashboard", href: "/", icon: LayoutDashboard },
  { label: "Transactions", href: "/transactions", icon: ArrowLeftRight },
  { label: "Approvals", href: "/approvals", icon: CheckCircle2 },
  { label: "Mandates", href: "/mandates", icon: FileText },
  { label: "Devices", href: "/devices", icon: Smartphone },
  { label: "Triggers", href: "/triggers", icon: Zap },
  { label: "Policy", href: "/policy", icon: Shield },
  { label: "Security", href: "/security", icon: Lock },
  { label: "Enrollment", href: "/enrollment", icon: UserCheck },
  { label: "References", href: "/references", icon: BookOpen },
  { label: "Export", href: "/export", icon: Download },
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
              <span>Switch to {theme === "dark" ? "Light" : "Dark"} Mode</span>
            </CommandItem>
          </CommandGroup>
        </CommandList>
      </CommandPalette>
    </>
  );
}
