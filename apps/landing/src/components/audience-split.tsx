import { Button } from "@counter/ui";
import { ArrowRight, Store, Wallet } from "lucide-react";

const MERCHANT_CONSOLE_URL =
  process.env["NEXT_PUBLIC_MERCHANT_CONSOLE_URL"] ?? "http://localhost:3000";
const WALLET_CONSOLE_URL =
  process.env["NEXT_PUBLIC_WALLET_CONSOLE_URL"] ?? "http://localhost:3001";

const MERCHANT_LINES = [
  "Connect your Shopify store and a Razorpay test-mode account",
  "Set the ceiling, categories, and payment paths agents must sell inside",
  "See every agent purchase, and every purchase your rules declined",
];

const WALLET_LINES = [
  "Fund a spending balance with a real Razorpay test-mode payment",
  "Register your agent's signing key and set its ceiling and allowlist",
  "Let it transact unattended inside the limit, and audit exactly what it did",
];

function AudienceColumn({
  icon: Icon,
  eyebrow,
  title,
  lines,
  ctaLabel,
  ctaHref,
}: {
  icon: typeof Store;
  eyebrow: string;
  title: string;
  lines: string[];
  ctaLabel: string;
  ctaHref: string;
}) {
  return (
    <div className="border border-[var(--border)] bg-[var(--surface)] flex flex-col">
      <div className="flex items-center gap-3 border-b border-[var(--border)] px-6 py-5">
        <div className="flex h-9 w-9 items-center justify-center border border-[var(--border)] text-[var(--brand-red)]">
          <Icon size={16} />
        </div>
        <div>
          <p className="font-mono text-[11px] uppercase tracking-widest text-[var(--foreground-muted)]" data-manifest-figure>
            {eyebrow}
          </p>
          <h3 className="text-lg font-semibold text-[var(--foreground)]">{title}</h3>
        </div>
      </div>
      <ul className="flex-1 px-6 py-5 space-y-3">
        {lines.map((line) => (
          <li key={line} className="text-sm text-[var(--foreground-secondary)] leading-relaxed pl-4 border-l border-[var(--border-secondary)]">
            {line}
          </li>
        ))}
      </ul>
      <div className="px-6 py-5 border-t border-[var(--border)]">
        <Button variant="outline" className="w-full gap-2" asChild>
          <a href={ctaHref}>
            {ctaLabel}
            <ArrowRight size={14} />
          </a>
        </Button>
      </div>
    </div>
  );
}

export function AudienceSplit() {
  return (
    <section className="relative py-20 sm:py-28 border-t border-[var(--border)]">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="mb-14 max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--foreground-muted)] mb-3" data-manifest-figure>
            Two sides, one mandate
          </p>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--foreground)]">
            Merchants declare what agents may buy. Wallet users declare what their agent may spend.
          </h2>
        </div>

        <div className="grid gap-6 sm:grid-cols-2">
          <AudienceColumn
            icon={Store}
            eyebrow="For merchants"
            title="Make your store agent-reachable"
            lines={MERCHANT_LINES}
            ctaLabel="Connect your store"
            ctaHref={MERCHANT_CONSOLE_URL}
          />
          <AudienceColumn
            icon={Wallet}
            eyebrow="For wallet users"
            title="Let your agent spend inside a limit you set"
            lines={WALLET_LINES}
            ctaLabel="Set up your wallet"
            ctaHref={WALLET_CONSOLE_URL}
          />
        </div>

        <p className="mt-8 text-xs text-[var(--foreground-secondary)] max-w-2xl">
          Everything above runs in test mode today — Razorpay test-mode payments, one connected
          Shopify test store, INR only. Settlement to a merchant&apos;s own account isn&apos;t
          automated yet; merchants see a real pending-settlement figure, not a fabricated payout.
        </p>
      </div>
    </section>
  );
}
