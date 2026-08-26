import type { ReactNode } from "react";
import { ThemeProvider } from "@counter/ui";
import { ConsoleShell } from "@/components/console-shell";
import "./globals.css";

export const metadata = {
  title: "Counter Merchant Console",
  description: "Counter Merchant configuration and monitoring console.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <body className="antialiased">
        <ThemeProvider defaultTheme="dark" attribute="class">
          <ConsoleShell>{children}</ConsoleShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
