import { FileSignature, ScanSearch, BadgeCheck } from "lucide-react";

const STEPS = [
  {
    number: "01",
    icon: FileSignature,
    title: "The mandate is declared",
    description:
      "A wallet user sets a ceiling, a merchant allowlist, and an expiry, then signs it. That signed mandate — not a card, not a bank credential — is the only authority the agent ever holds.",
  },
  {
    number: "02",
    icon: ScanSearch,
    title: "Every purchase is checked before it exists",
    description:
      "When the agent finds something to buy, the amount and merchant are checked against the mandate first. Nothing is created, charged, or reversed after the fact — the check happens before the order does.",
  },
  {
    number: "03",
    icon: BadgeCheck,
    title: "Cleared or declined, with a receipt either way",
    description:
      "Inside the ceiling: the order is placed and a signed receipt is issued. Over the ceiling: the purchase is stamped declined and nothing crosses the border. Both outcomes are visible in the wallet's history.",
  },
] as const;

export function HowItClears() {
  return (
    <section id="how-it-clears" className="relative py-20 sm:py-28 border-t border-[var(--border)]">
      <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
        <div className="mb-14 max-w-2xl">
          <p className="font-mono text-xs uppercase tracking-widest text-[var(--foreground-muted)] mb-3" data-manifest-figure>
            How it clears
          </p>
          <h2 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight text-[var(--foreground)]">
            The check happens before the effect, not after.
          </h2>
        </div>

        <div className="divide-y divide-[var(--border)]">
          {STEPS.map((step) => (
            <div
              key={step.number}
              className="grid grid-cols-[auto_auto_1fr] items-start gap-5 py-8 first:pt-0 last:pb-0"
            >
              <span className="font-mono text-sm text-[var(--foreground-muted)] pt-1" data-manifest-figure>
                {step.number}
              </span>
              <div className="flex h-10 w-10 items-center justify-center border border-[var(--border)] text-[var(--brand-red)]">
                <step.icon size={18} />
              </div>
              <div>
                <h3 className="text-lg font-semibold text-[var(--foreground)] mb-1.5">
                  {step.title}
                </h3>
                <p className="text-sm text-[var(--foreground-secondary)] leading-relaxed max-w-xl">
                  {step.description}
                </p>
              </div>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
