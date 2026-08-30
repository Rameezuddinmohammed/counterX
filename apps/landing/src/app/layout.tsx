import type { ReactNode } from "react";
import type { Metadata } from "next";
import { ThemeProvider } from "@counter/ui";
import { Inter } from "next/font/google";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  variable: "--font-inter",
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
    <html lang="en" className={inter.variable} suppressHydrationWarning>
      <body className="font-sans antialiased">
        <ThemeProvider attribute="class" defaultTheme="dark" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </body>
    </html>
  );
}
