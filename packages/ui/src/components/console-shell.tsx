"use client";

import { useState, type ReactNode } from "react";
import { SidebarProvider } from "./sidebar";
import { Toaster } from "./toast";

/**
 * Props for the ConsoleShell layout wrapper.
 *
 * Each app provides its own sidebar, top-bar, and command-palette components
 * via render props so the shell layout is shared but navigation differs per app.
 */
export interface ConsoleShellProps {
  children: ReactNode;
  /** Render the app-specific sidebar */
  renderSidebar: () => ReactNode;
  /** Render the app-specific top bar; receives callback to open command palette */
  renderTopBar: (onCommandPaletteOpen: () => void) => ReactNode;
  /**
   * Render the app-specific command palette wrapper.
   * Receives open state, setter, and children that must be rendered inside.
   */
  renderCommandPalette?: (
    open: boolean,
    onOpenChange: (open: boolean) => void,
    children: ReactNode,
  ) => ReactNode;
}

export function ConsoleShell({
  children,
  renderSidebar,
  renderTopBar,
  renderCommandPalette,
}: ConsoleShellProps) {
  const [commandPaletteOpen, setCommandPaletteOpen] = useState(false);

  const content = (
    <div className="flex h-screen overflow-hidden bg-[var(--background)]">
      {renderSidebar()}
      <div className="flex flex-1 flex-col overflow-hidden">
        {renderTopBar(() => setCommandPaletteOpen(true))}
        <main className="flex-1 overflow-y-auto p-6 console-grid-bg">{children}</main>
      </div>
    </div>
  );

  return (
    <SidebarProvider>
      {renderCommandPalette
        ? renderCommandPalette(commandPaletteOpen, setCommandPaletteOpen, content)
        : content}
      <Toaster />
    </SidebarProvider>
  );
}
