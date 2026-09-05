"use client";

import { useState } from "react";
import { Button, CounterLogo, CounterWordmark, ThemeToggle } from "@counter/ui";
import { Menu, X } from "lucide-react";

const MERCHANT_CONSOLE_URL =
  process.env["NEXT_PUBLIC_MERCHANT_CONSOLE_URL"] ?? "http://localhost:3000";
const WALLET_CONSOLE_URL = process.env["NEXT_PUBLIC_WALLET_CONSOLE_URL"] ?? "http://localhost:3001";

const NAV_LINKS = [
  { href: "#how-it-clears", label: "How it clears" },
  { href: "/docs", label: "Docs" },
] as const;

export function Header() {
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false);

  return (
    <header className="fixed top-0 left-0 right-0 z-50 border-b border-[var(--border)] bg-[var(--background)]/95 backdrop-blur-sm">
      <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4 sm:px-6 lg:px-8">
        <a href="/" className="flex items-center gap-2 no-underline">
          <CounterLogo size={26} className="text-[var(--foreground)]" />
          <CounterWordmark size={26} className="hidden sm:block text-[var(--foreground)]" />
        </a>

        <nav className="hidden md:flex items-center gap-8">
          {NAV_LINKS.map((link) => (
            <a
              key={link.href}
              href={link.href}
              className="text-sm text-[var(--foreground-secondary)] transition-colors hover:text-[var(--foreground)]"
            >
              {link.label}
            </a>
          ))}
        </nav>

        <div className="hidden md:flex items-center gap-3">
          <ThemeToggle />
          <Button variant="outline" size="sm" asChild>
            <a href={MERCHANT_CONSOLE_URL}>Merchant console</a>
          </Button>
          <Button variant="default" size="sm" asChild>
            <a href={WALLET_CONSOLE_URL}>Set up your wallet</a>
          </Button>
        </div>

        <button
          className="md:hidden p-2 text-[var(--foreground-secondary)]"
          onClick={() => setMobileMenuOpen(!mobileMenuOpen)}
          aria-label="Toggle menu"
        >
          {mobileMenuOpen ? <X size={20} /> : <Menu size={20} />}
        </button>
      </div>

      {mobileMenuOpen && (
        <div className="md:hidden border-t border-[var(--border)] bg-[var(--background)]">
          <nav className="flex flex-col gap-1 p-4">
            {NAV_LINKS.map((link) => (
              <a
                key={link.href}
                href={link.href}
                className="px-3 py-2 text-sm text-[var(--foreground-secondary)] transition-colors hover:bg-[var(--surface-secondary)] hover:text-[var(--foreground)]"
                onClick={() => setMobileMenuOpen(false)}
              >
                {link.label}
              </a>
            ))}
            <div className="mt-3 flex flex-col gap-2 border-t border-[var(--border)] pt-3">
              <ThemeToggle />
              <Button variant="outline" size="sm" asChild>
                <a href={MERCHANT_CONSOLE_URL}>Merchant console</a>
              </Button>
              <Button variant="default" size="sm" asChild>
                <a href={WALLET_CONSOLE_URL}>Set up your wallet</a>
              </Button>
            </div>
          </nav>
        </div>
      )}
    </header>
  );
}
