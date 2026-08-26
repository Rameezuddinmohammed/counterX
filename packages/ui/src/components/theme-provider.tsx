"use client";

import * as React from "react";
import { ThemeProvider as NextThemesProvider } from "next-themes";

type Attribute = `data-${string}` | "class";

export interface ThemeProviderProps {
  children: React.ReactNode;
  defaultTheme?: string;
  storageKey?: string;
  enableSystem?: boolean;
  disableTransitionOnChange?: boolean;
  attribute?: Attribute | Attribute[];
}

export function ThemeProvider({
  children,
  defaultTheme = "dark",
  storageKey = "counter-theme",
  enableSystem = true,
  disableTransitionOnChange = false,
  attribute = "class",
}: ThemeProviderProps) {
  return (
    <NextThemesProvider
      attribute={attribute}
      defaultTheme={defaultTheme}
      storageKey={storageKey}
      enableSystem={enableSystem}
      disableTransitionOnChange={disableTransitionOnChange}
    >
      {children}
    </NextThemesProvider>
  );
}
