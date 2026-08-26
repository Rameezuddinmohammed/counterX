"use client";

import { ConsoleShell as SharedConsoleShell } from "@counter/ui";
import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import { CommandPaletteProvider } from "@/components/command-palette-provider";

interface ConsoleShellProps {
  children: React.ReactNode;
}

export function ConsoleShell({ children }: ConsoleShellProps) {
  return (
    <SharedConsoleShell
      renderSidebar={() => <AppSidebar />}
      renderTopBar={(onOpen) => <TopBar onCommandPaletteOpen={onOpen} />}
      renderCommandPalette={(open, onOpenChange, content) => (
        <CommandPaletteProvider open={open} onOpenChange={onOpenChange}>
          {content}
        </CommandPaletteProvider>
      )}
    >
      {children}
    </SharedConsoleShell>
  );
}
