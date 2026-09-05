import type { ReactNode } from "react";
import { ThemeProvider } from "@counter/ui";
import { Space_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
import { ConsoleShell } from "@/components/console-shell";
import "./globals.css";

const spaceGrotesk = Space_Grotesk({
  subsets: ["latin"],
  variable: "--font-space-grotesk",
  weight: ["500", "600", "700"],
});

const plexSans = IBM_Plex_Sans({
  subsets: ["latin"],
  variable: "--font-plex-sans",
  weight: ["400", "500", "600"],
});

const plexMono = IBM_Plex_Mono({
  subsets: ["latin"],
  variable: "--font-plex-mono",
  weight: ["400", "500"],
});

export const metadata = {
  title: "Counter Wallet Console",
  description: "Counter Wallet management console for pilot operations.",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${plexSans.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <body className="antialiased">
        <ThemeProvider defaultTheme="dark" attribute="class">
          <ConsoleShell>{children}</ConsoleShell>
        </ThemeProvider>
      </body>
    </html>
  );
}
