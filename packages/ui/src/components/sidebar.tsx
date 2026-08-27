"use client";

import * as React from "react";
import { PanelLeftClose, PanelLeft } from "lucide-react";
import { cn } from "../lib/utils";

interface SidebarContextType {
  collapsed: boolean;
  setCollapsed: (collapsed: boolean) => void;
  toggle: () => void;
}

const SidebarContext = React.createContext<SidebarContextType>({
  collapsed: false,
  setCollapsed: () => undefined,
  toggle: () => undefined,
});

export function useSidebar() {
  return React.useContext(SidebarContext);
}

export interface SidebarProviderProps {
  children: React.ReactNode;
  defaultCollapsed?: boolean;
}

export function SidebarProvider({
  children,
  defaultCollapsed = false,
}: SidebarProviderProps) {
  const [collapsed, setCollapsed] = React.useState(defaultCollapsed);
  const toggle = React.useCallback(() => setCollapsed((c) => !c), []);

  return (
    <SidebarContext.Provider value={{ collapsed, setCollapsed, toggle }}>
      {children}
    </SidebarContext.Provider>
  );
}

export type SidebarProps = React.HTMLAttributes<HTMLElement>;

export function Sidebar({ className, children, ...props }: SidebarProps) {
  const { collapsed } = useSidebar();

  return (
    <aside
      className={cn(
        "flex h-full flex-col border-r border-[var(--border)] bg-[var(--surface)] transition-all duration-300",
        collapsed ? "w-16" : "w-64",
        className
      )}
      {...props}
    >
      {children}
    </aside>
  );
}

export function SidebarHeader({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex items-center gap-2 px-4 py-4", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function SidebarContent({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn("flex-1 overflow-y-auto px-3 py-2", className)}
      {...props}
    >
      {children}
    </div>
  );
}

export function SidebarSection({
  className,
  title,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement> & { title?: string }) {
  const { collapsed } = useSidebar();

  return (
    <div className={cn("mb-4", className)} {...props}>
      {title && !collapsed && (
        <p className="mb-2 px-2 text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
          {title}
        </p>
      )}
      <nav className="space-y-1">{children}</nav>
    </div>
  );
}

export interface SidebarItemProps
  extends React.ButtonHTMLAttributes<HTMLButtonElement> {
  icon?: React.ReactNode;
  active?: boolean;
  badge?: string | number;
}

export function SidebarItem({
  className,
  icon,
  active,
  badge,
  children,
  ...props
}: SidebarItemProps) {
  const { collapsed } = useSidebar();

  return (
    <button
      className={cn(
        "flex w-full items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors",
        active
          ? "bg-[var(--brand-orange)]/10 text-[var(--brand-orange)]"
          : "text-[var(--foreground-secondary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--foreground)]",
        collapsed && "justify-center px-2",
        className
      )}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {!collapsed && <span className="flex-1 text-left">{children}</span>}
      {!collapsed && badge !== undefined && (
        <span className="rounded-full bg-[var(--surface-secondary)] px-2 py-0.5 text-xs text-[var(--foreground-muted)]">
          {badge}
        </span>
      )}
    </button>
  );
}

export function SidebarFooter({
  className,
  children,
  ...props
}: React.HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={cn(
        "border-t border-[var(--border)] px-3 py-3",
        className
      )}
      {...props}
    >
      {children}
    </div>
  );
}

export function SidebarToggle({
  className,
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement>) {
  const { collapsed, toggle } = useSidebar();

  return (
    <button
      className={cn(
        "flex items-center justify-center rounded-lg p-2 text-[var(--foreground-secondary)] hover:bg-[var(--surface-secondary)] hover:text-[var(--foreground)] transition-colors",
        className
      )}
      onClick={toggle}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      {...props}
    >
      {collapsed ? (
        <PanelLeft className="h-5 w-5" />
      ) : (
        <PanelLeftClose className="h-5 w-5" />
      )}
    </button>
  );
}
