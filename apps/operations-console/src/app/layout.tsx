import type { ReactNode } from "react";
import { ThemeProvider } from "@counter/ui";
import { ConsoleShell } from "@/components/console-shell";
import "./globals.css";

export const metadata = {
  title: "Counter Operations Console",
  description: "Counter platform operations, monitoring, and incident management console.",
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
