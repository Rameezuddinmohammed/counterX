/**
 * Smoke tests for @counter/ui package exports.
 *
 * Verifies that all public exports are defined. React components created
 * with forwardRef are objects (not functions), so we only assert they are defined.
 */

import { describe, it, expect } from "vitest";
import * as UI from "../index.js";

describe("@counter/ui exports", () => {
  describe("utility functions", () => {
    it("exports cn() utility", () => {
      expect(UI.cn).toBeDefined();
      expect(typeof UI.cn).toBe("function");
    });
  });

  describe("core components", () => {
    it("exports Button component", () => {
      expect(UI.Button).toBeDefined();
    });

    it("exports buttonVariants", () => {
      expect(UI.buttonVariants).toBeDefined();
      expect(typeof UI.buttonVariants).toBe("function");
    });

    it("exports Badge component", () => {
      expect(UI.Badge).toBeDefined();
      expect(typeof UI.Badge).toBe("function");
    });

    it("exports Card and sub-components", () => {
      expect(UI.Card).toBeDefined();
      expect(UI.CardHeader).toBeDefined();
      expect(UI.CardTitle).toBeDefined();
      expect(UI.CardDescription).toBeDefined();
      expect(UI.CardContent).toBeDefined();
      expect(UI.CardFooter).toBeDefined();
    });

    it("exports Input component", () => {
      expect(UI.Input).toBeDefined();
    });

    it("exports Dialog and sub-components", () => {
      expect(UI.Dialog).toBeDefined();
      expect(UI.DialogTrigger).toBeDefined();
      expect(UI.DialogContent).toBeDefined();
      expect(UI.DialogHeader).toBeDefined();
      expect(UI.DialogFooter).toBeDefined();
      expect(UI.DialogTitle).toBeDefined();
      expect(UI.DialogDescription).toBeDefined();
    });
  });

  describe("dropdown and tooltip", () => {
    it("exports DropdownMenu and sub-components", () => {
      expect(UI.DropdownMenu).toBeDefined();
      expect(UI.DropdownMenuTrigger).toBeDefined();
      expect(UI.DropdownMenuContent).toBeDefined();
      expect(UI.DropdownMenuItem).toBeDefined();
      expect(UI.DropdownMenuSeparator).toBeDefined();
    });

    it("exports Tooltip and sub-components", () => {
      expect(UI.Tooltip).toBeDefined();
      expect(UI.TooltipTrigger).toBeDefined();
      expect(UI.TooltipContent).toBeDefined();
      expect(UI.TooltipProvider).toBeDefined();
    });
  });

  describe("form components", () => {
    it("exports Switch component", () => {
      expect(UI.Switch).toBeDefined();
    });

    it("exports Tabs and sub-components", () => {
      expect(UI.Tabs).toBeDefined();
      expect(UI.TabsList).toBeDefined();
      expect(UI.TabsTrigger).toBeDefined();
      expect(UI.TabsContent).toBeDefined();
    });
  });

  describe("layout components", () => {
    it("exports Sidebar and sub-components", () => {
      expect(UI.Sidebar).toBeDefined();
      expect(UI.SidebarProvider).toBeDefined();
      expect(UI.SidebarHeader).toBeDefined();
      expect(UI.SidebarContent).toBeDefined();
      expect(UI.SidebarSection).toBeDefined();
      expect(UI.SidebarItem).toBeDefined();
      expect(UI.SidebarFooter).toBeDefined();
      expect(UI.SidebarToggle).toBeDefined();
      expect(UI.useSidebar).toBeDefined();
      expect(typeof UI.useSidebar).toBe("function");
    });

    it("exports Avatar and sub-components", () => {
      expect(UI.Avatar).toBeDefined();
      expect(UI.AvatarImage).toBeDefined();
      expect(UI.AvatarFallback).toBeDefined();
    });

    it("exports Separator component", () => {
      expect(UI.Separator).toBeDefined();
    });

    it("exports Breadcrumbs component", () => {
      expect(UI.Breadcrumbs).toBeDefined();
      expect(typeof UI.Breadcrumbs).toBe("function");
    });
  });

  describe("feedback components", () => {
    it("exports Spinner and loading components", () => {
      expect(UI.Spinner).toBeDefined();
      expect(UI.Skeleton).toBeDefined();
      expect(UI.SkeletonText).toBeDefined();
      expect(UI.SkeletonCard).toBeDefined();
      expect(UI.LoadingOverlay).toBeDefined();
    });

    it("exports EmptyState component", () => {
      expect(UI.EmptyState).toBeDefined();
      expect(typeof UI.EmptyState).toBe("function");
    });

    it("exports ErrorState component", () => {
      expect(UI.ErrorState).toBeDefined();
      expect(typeof UI.ErrorState).toBe("function");
    });

    it("exports Toaster and toast", () => {
      expect(UI.Toaster).toBeDefined();
      expect(UI.toast).toBeDefined();
      expect(typeof UI.toast).toBe("function");
    });
  });

  describe("data display components", () => {
    it("exports DataTable component", () => {
      expect(UI.DataTable).toBeDefined();
      expect(typeof UI.DataTable).toBe("function");
    });

    it("exports StatCard component", () => {
      expect(UI.StatCard).toBeDefined();
      expect(typeof UI.StatCard).toBe("function");
    });
  });

  describe("brand components", () => {
    it("exports CounterLogo component", () => {
      expect(UI.CounterLogo).toBeDefined();
      expect(typeof UI.CounterLogo).toBe("function");
    });

    it("exports CounterWordmark component", () => {
      expect(UI.CounterWordmark).toBeDefined();
      expect(typeof UI.CounterWordmark).toBe("function");
    });
  });

  describe("command palette", () => {
    it("exports Command components", () => {
      expect(UI.Command).toBeDefined();
      expect(UI.CommandDialog).toBeDefined();
      expect(UI.CommandInput).toBeDefined();
      expect(UI.CommandList).toBeDefined();
      expect(UI.CommandEmpty).toBeDefined();
      expect(UI.CommandGroup).toBeDefined();
      expect(UI.CommandItem).toBeDefined();
      expect(UI.CommandPalette).toBeDefined();
    });
  });

  describe("theme components", () => {
    it("exports ThemeProvider component", () => {
      expect(UI.ThemeProvider).toBeDefined();
      expect(typeof UI.ThemeProvider).toBe("function");
    });

    it("exports ThemeToggle component", () => {
      expect(UI.ThemeToggle).toBeDefined();
      expect(typeof UI.ThemeToggle).toBe("function");
    });
  });

  describe("shared layout wrappers", () => {
    it("exports ConsoleShell component", () => {
      expect(UI.ConsoleShell).toBeDefined();
      expect(typeof UI.ConsoleShell).toBe("function");
    });

    it("exports PageWrapper component", () => {
      expect(UI.PageWrapper).toBeDefined();
      expect(typeof UI.PageWrapper).toBe("function");
    });
  });
});
