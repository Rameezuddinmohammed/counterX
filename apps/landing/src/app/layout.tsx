import type { ReactNode } from "react";
import type { Metadata } from "next";
import { ThemeProvider } from "@counter/ui";
import { Space_Grotesk, IBM_Plex_Sans, IBM_Plex_Mono } from "next/font/google";
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

export const metadata: Metadata = {
  title: "Counter - The commerce layer for AI agents",
  description:
    "Counter is the commerce infrastructure that lets AI agents transact on behalf of users. Secure wallets, merchant control planes, trust protocols, and real-time policy engines.",
  keywords: [
    "AI commerce",
    "AI agents",
    "agent wallets",
    "merchant API",
    "trust protocol",
    "commerce infrastructure",
  ],
  openGraph: {
    title: "Counter - The commerce layer for AI agents",
    description: "The commerce infrastructure that lets AI agents transact on behalf of users.",
    url: "https://getcounter.in",
    siteName: "Counter",
    type: "website",
  },
  twitter: {
    card: "summary_large_image",
    title: "Counter - The commerce layer for AI agents",
    description: "The commerce infrastructure that lets AI agents transact on behalf of users.",
  },
  robots: {
    index: true,
    follow: true,
  },
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang="en"
      className={`${spaceGrotesk.variable} ${plexSans.variable} ${plexMono.variable}`}
      suppressHydrationWarning
    >
      <body className="font-sans antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
