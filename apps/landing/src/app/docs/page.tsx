import { Book, Code, Key, Webhook, Shield, Zap } from "lucide-react";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

const DOC_SECTIONS = [
  {
    icon: Book,
    title: "Getting started",
    description: "Connecting a Shopify store, or setting up an agent's wallet, end to end.",
  },
  {
    icon: Key,
    title: "Authentication",
    description: "Auth0 login, agent signing keys, and how a mandate is signed and verified.",
  },
  {
    icon: Code,
    title: "MCP reference",
    description: "The tools an agent calls over MCP to discover merchants, quote, and purchase.",
  },
  {
    icon: Webhook,
    title: "Receipts & events",
    description: "The signed receipt issued on every cleared purchase, and what it attests to.",
  },
  {
    icon: Shield,
    title: "Mandates",
    description: "How a ceiling, merchant allowlist, and expiry are declared and enforced.",
  },
  {
    icon: Zap,
    title: "Policy configuration",
    description: "Category rules and payment paths a merchant sets for agents to sell inside.",
  },
] as const;

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <Header />
      <main className="pt-28 pb-20">
        <div className="mx-auto max-w-5xl px-4 sm:px-6 lg:px-8">
          <div className="mb-12 border-b border-[var(--border-secondary)] pb-6">
            <p className="font-mono text-xs uppercase tracking-widest text-[var(--foreground-muted)] mb-3" data-manifest-figure>
              Documentation
            </p>
            <h1 className="font-display text-3xl sm:text-4xl font-semibold tracking-tight mb-4">
              Written as the build ships.
            </h1>
            <p className="text-base text-[var(--foreground-secondary)] max-w-2xl">
              This build is still shipping — full written documentation for each area below is
              coming soon rather than posted shallow. The console and MCP tools it describes are
              already real.
            </p>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            {DOC_SECTIONS.map((section) => (
              <div
                key={section.title}
                className="border border-[var(--border)] bg-[var(--surface)] p-5"
              >
                <div className="mb-3 flex h-9 w-9 items-center justify-center border border-[var(--border)] text-[var(--brand-red)]">
                  <section.icon size={16} />
                </div>
                <h3 className="text-base font-semibold mb-1.5">{section.title}</h3>
                <p className="text-sm text-[var(--foreground-secondary)] leading-relaxed mb-3">
                  {section.description}
                </p>
                <span className="inline-flex items-center border border-[var(--manifest-ochre)]/40 bg-[var(--manifest-ochre)]/10 px-2 py-0.5 text-xs font-medium text-[var(--manifest-ochre)]">
                  Coming soon
                </span>
              </div>
            ))}
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
