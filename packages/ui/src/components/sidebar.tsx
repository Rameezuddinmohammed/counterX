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

export function SidebarProvider({ children, defaultCollapsed = false }: SidebarProviderProps) {
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
        "flex h-full flex-col border-r border-[var(--border)] bg-[var(--surface-secondary)] transition-all duration-300 select-none",
        collapsed ? "w-16" : "w-64",
        className,
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
      className={cn(
        "flex h-14 shrink-0 items-center justify-between border-b border-[var(--border)] px-4",
        className,
      )}
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
    <div className={cn("flex-1 overflow-y-auto px-3 py-3 space-y-4", className)} {...props}>
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
    <div className={cn("space-y-1", className)} {...props}>
      {title && !collapsed && (
        <p className="px-2.5 text-[10px] font-semibold uppercase tracking-wider text-[var(--foreground-muted)]/80">
          {title}
        </p>
      )}
      <nav className="space-y-0.5">{children}</nav>
    </div>
  );
}

export interface SidebarItemProps extends React.ButtonHTMLAttributes<HTMLButtonElement> {
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
        "group relative flex w-full items-center gap-3 rounded-lg px-2.5 py-2 text-sm font-medium transition-all duration-150 text-left outline-none cursor-pointer",
        active
          ? "bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 font-semibold"
          : "text-[var(--foreground-secondary)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)]",
        collapsed && "justify-center px-2",
        className,
      )}
      {...props}
    >
      {active && (
        <span className="absolute left-0 top-1.5 bottom-1.5 w-1 rounded-r-full bg-indigo-600 dark:bg-indigo-400" />
      )}
      {icon && (
        <span
          className={cn(
            "shrink-0 transition-colors",
            active
              ? "text-indigo-600 dark:text-indigo-400"
              : "text-[var(--foreground-muted)] group-hover:text-[var(--foreground)]",
          )}
        >
          {icon}
        </span>
      )}
      {!collapsed && <span className="flex-1 truncate">{children}</span>}
      {!collapsed && badge !== undefined && (
        <span
          className={cn(
            "ml-auto rounded-full px-2 py-0.5 text-[10px] font-mono font-medium",
            active
              ? "bg-indigo-500/20 text-indigo-600 dark:text-indigo-300"
              : "bg-[var(--surface-hover)] text-[var(--foreground-muted)]",
          )}
        >
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
        "shrink-0 border-t border-[var(--border)] bg-[var(--surface-secondary)] px-3 py-3",
        className,
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
        "flex h-7 w-7 items-center justify-center rounded-lg text-[var(--foreground-muted)] hover:bg-[var(--surface-hover)] hover:text-[var(--foreground)] transition-colors cursor-pointer",
        className,
      )}
      onClick={toggle}
      aria-label={collapsed ? "Expand sidebar" : "Collapse sidebar"}
      {...props}
    >
      {collapsed ? <PanelLeft className="h-4 w-4" /> : <PanelLeftClose className="h-4 w-4" />}
    </button>
  );
}
