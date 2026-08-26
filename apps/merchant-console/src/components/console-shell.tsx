"use client";

import { useState } from "react";
import { SidebarProvider, Toaster } from "@counter/ui";
import { AppSidebar } from "@/components/app-sidebar";
import { TopBar } from "@/components/top-bar";
import { CommandPaletteProvider } from "@/components/command-palette-provider";

interface ConsoleShellProps {
  children: React.ReactNode;
}

export function ConsoleShell({ children }: ConsoleShellProps) {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  return (
    <SidebarProvider>
      <CommandPaletteProvider
        open={commandPaletteOpen}
        onOpenChange={setCommandPaletteOpen}
      >
        <div className="flex h-screen overflow-hidden bg-[var(--background)]">
          <AppSidebar />
          <div className="flex flex-1 flex-col overflow-hidden">
            <TopBar onCommandPaletteOpen={() => setCommandPaletteOpen(true)} />
            <main className="flex-1 overflow-y-auto p-6 console-grid-bg">
              {children}
            </main>
          </div>
        </div>
        <Toaster />
      </CommandPaletteProvider>
    </SidebarProvider>
  );
}
