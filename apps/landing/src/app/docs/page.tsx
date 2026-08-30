import { Button } from "@counter/ui";
import { ArrowRight, Book, Code, Key, Webhook, Shield, Zap } from "lucide-react";
import { Header } from "@/components/header";
import { Footer } from "@/components/footer";

const DOC_SECTIONS = [
  {
    icon: Book,
    title: "Getting Started",
    description:
      "Quick start guide to integrate Counter into your AI agent or merchant application.",
    href: "#",
  },
  {
    icon: Key,
    title: "Authentication",
    description: "API keys, OAuth flows, and agent identity management for secure access.",
    href: "#",
  },
  {
    icon: Code,
    title: "API Reference",
    description:
      "Complete REST API documentation with request/response examples for every endpoint.",
    href: "#",
  },
  {
    icon: Webhook,
    title: "Webhooks & Events",
    description: "Real-time event streams and webhook integrations for transaction notifications.",
    href: "#",
  },
  {
    icon: Shield,
    title: "Policy Engine",
    description: "Define and manage transaction policies, spending limits, and approval workflows.",
    href: "#",
  },
  {
    icon: Zap,
    title: "SDKs & Libraries",
    description:
      "Official client libraries for Node.js, Python, and Go with TypeScript definitions.",
    href: "#",
  },
] as const;

export default function DocsPage() {
  return (
    <div className="min-h-screen bg-[var(--background)] text-[var(--foreground)]">
      <Header />
      <main className="pt-24 pb-16">
        <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
          {/* Page header */}
          <div className="mb-12">
            <h1 className="text-3xl sm:text-4xl font-bold tracking-tight mb-4">Documentation</h1>
            <p className="text-lg text-[var(--foreground-secondary)] max-w-2xl">
              Everything you need to integrate Counter into your AI agent infrastructure. From quick
              starts to advanced policy configuration.
            </p>
          </div>

          {/* Doc sections grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
            {DOC_SECTIONS.map((section) => (
              <a
                key={section.title}
                href={section.href}
                className="group rounded-xl border border-[var(--border)] bg-[var(--surface)]/50 p-6 transition-all hover:border-orange-500/30 hover:bg-[var(--surface)]"
              >
                <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10 text-orange-500">
                  <section.icon size={20} />
                </div>
                <h3 className="text-lg font-semibold mb-2 group-hover:text-orange-500 transition-colors">
                  {section.title}
                </h3>
                <p className="text-sm text-[var(--foreground-secondary)] leading-relaxed mb-4">
                  {section.description}
                </p>
                <span className="inline-flex items-center gap-1 text-sm text-orange-500 font-medium">
                  Read more
                  <ArrowRight
                    size={14}
                    className="transition-transform group-hover:translate-x-0.5"
                  />
                </span>
              </a>
            ))}
          </div>

          {/* CTA */}
          <div className="mt-16 text-center">
            <p className="text-[var(--foreground-secondary)] mb-4">Need help getting started?</p>
            <Button variant="outline" className="gap-2">
              Contact Developer Support
              <ArrowRight size={16} />
            </Button>
          </div>
        </div>
      </main>
      <Footer />
    </div>
  );
}
