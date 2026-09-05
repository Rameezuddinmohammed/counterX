"use client";

import { Button } from "@counter/ui";
import { ArrowRight, CheckCircle2, XCircle } from "lucide-react";

const WALLET_CONSOLE_URL = process.env["NEXT_PUBLIC_WALLET_CONSOLE_URL"] ?? "http://localhost:3001";
const MERCHANT_CONSOLE_URL =
  process.env["NEXT_PUBLIC_MERCHANT_CONSOLE_URL"] ?? "http://localhost:3000";

/**
 * A single line of a manifest ledger — a declared field and its value,
 * set in tabular figures where the value is numeric or an id.
 */
function ManifestField({
  label,
  value,
  mono = false,
}: {
  label: string;
  value: string;
  mono?: boolean;
}) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-2 border-b border-[var(--border)]">
      <span className="text-xs uppercase tracking-wider text-[var(--foreground-muted)]">
        {label}
      </span>
      <span
        className={
          mono ? "font-mono text-sm text-[var(--foreground)]" : "text-sm text-[var(--foreground)]"
        }
        data-manifest-figure={mono || undefined}
      >
        {value}
      </span>
    </div>
  );
}

function ClearedEntry() {
  return (
    <div className="animate-stamp-in border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-secondary)] px-4 py-2.5">
        <span className="font-mono text-xs text-[var(--foreground-muted)]" data-manifest-figure>
          MANIFEST · MND-7731-A
        </span>
        <span className="inline-flex items-center gap-1.5 border border-[var(--clearance-teal)]/40 bg-[var(--clearance-teal)]/10 px-2 py-0.5 text-xs font-medium text-[var(--clearance-teal)]">
          <CheckCircle2 size={12} />
          CLEARED
        </span>
      </div>
      <div className="px-4 py-1">
        <ManifestField label="Merchant" value="Counter Demo Apparel" />
        <ManifestField label="Item" value="Merino crew, size M" />
        <ManifestField label="Amount" value="₹1,240.00" mono />
        <ManifestField label="Mandate ceiling" value="₹2,000.00 / order" mono />
      </div>
      <div className="px-4 py-3 text-xs text-[var(--foreground-secondary)]">
        Inside the declared ceiling. Cleared before the order was created.
      </div>
    </div>
  );
}

function DeclinedEntry() {
  return (
    <div className="animate-stamp-in border border-[var(--border)] bg-[var(--surface)]">
      <div className="flex items-center justify-between border-b border-[var(--border)] bg-[var(--surface-secondary)] px-4 py-2.5">
        <span className="font-mono text-xs text-[var(--foreground-muted)]" data-manifest-figure>
          MANIFEST · MND-7731-B
        </span>
        <span className="inline-flex items-center gap-1.5 border border-[var(--brand-red)]/40 bg-[var(--brand-red)]/10 px-2 py-0.5 text-xs font-medium text-[var(--brand-red)]">
          <XCircle size={12} />
          DECLINED
        </span>
      </div>
      <div className="px-4 py-1">
        <ManifestField label="Merchant" value="Counter Demo Apparel" />
        <ManifestField label="Item" value="Wool overcoat" />
        <ManifestField label="Amount" value="₹4,850.00" mono />
        <ManifestField label="Mandate ceiling" value="₹2,000.00 / order" mono />
      </div>
      <div className="px-4 py-3 text-xs text-[var(--foreground-secondary)]">
        Exceeds the ceiling by ₹2,850.00. Declined before any order existed — nothing to refund.
      </div>
    </div>
  );
}

export function ManifestEntry() {
  return (
    <section className="ledger-rules relative pt-32 pb-20 sm:pt-40 sm:pb-28">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        {/* Header row — the headline lives inside the manifest's own header,
            not in a separate hero block above it. */}
        <div className="mb-10 border-b border-[var(--border-secondary)] pb-6">
          <p
            className="mb-3 font-mono text-xs uppercase tracking-widest text-[var(--foreground-muted)]"
            data-manifest-figure
          >
            Declared · Sealed · Cleared
          </p>
          <h1 className="font-display text-4xl sm:text-5xl md:text-6xl font-semibold leading-[1.05] tracking-tight text-[var(--foreground)]">
            A mandate is a manifest.
          </h1>
          <p className="mt-4 max-w-xl text-base sm:text-lg text-[var(--foreground-secondary)]">
            Every purchase your agent makes clears a declared ceiling before it happens — or it is
            stamped declined before an order ever exists.
          </p>
        </div>

        {/* The two ledger entries */}
        <div className="grid gap-4 sm:grid-cols-2 max-w-3xl">
          <ClearedEntry />
          <DeclinedEntry />
        </div>

        {/* Disposition line — where a manifest's own actions sit */}
        <div className="mt-8 flex flex-col sm:flex-row sm:justify-end gap-3">
          <Button variant="outline" size="lg" asChild>
            <a href={MERCHANT_CONSOLE_URL}>Connect your store</a>
          </Button>
          <Button size="lg" className="gap-2" asChild>
            <a href={WALLET_CONSOLE_URL}>
              Set up your agent&apos;s wallet
              <ArrowRight size={16} />
            </a>
          </Button>
        </div>
      </div>
    </section>
  );
}
