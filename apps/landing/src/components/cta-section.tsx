"use client";

import { motion } from "framer-motion";
import { Button, Input } from "@counter/ui";
import { ArrowRight } from "lucide-react";

export function CTASection() {
  return (
    <section className="relative py-24 sm:py-32 overflow-hidden">
      {/* Background glow */}
      <div className="absolute inset-0">
        <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[800px] h-[400px] rounded-full bg-orange-500/5 blur-3xl" />
      </div>

      <div className="relative mx-auto max-w-4xl px-4 sm:px-6 lg:px-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
        >
          <h2 className="text-3xl sm:text-4xl lg:text-5xl font-bold tracking-tight mb-6">
            Ready to build the future of
            <br />
            <span className="text-gradient-orange">AI commerce?</span>
          </h2>
          <p className="mx-auto max-w-xl text-lg text-[var(--foreground-secondary)] mb-10">
            Join the early access program and be among the first to integrate
            Counter into your AI agent infrastructure.
          </p>
        </motion.div>

        {/* Email form */}
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          whileInView={{ opacity: 1, y: 0 }}
          viewport={{ once: true }}
          transition={{ delay: 0.1 }}
          className="mx-auto max-w-md"
        >
          <form
            onSubmit={(e) => e.preventDefault()}
            className="flex flex-col sm:flex-row gap-3"
          >
            <Input
              type="email"
              placeholder="Enter your email"
              className="flex-1 h-11 bg-[var(--surface)] border-[var(--border)]"
              aria-label="Email address"
            />
            <Button type="submit" size="lg" className="gap-2 whitespace-nowrap">
              Get Early Access
              <ArrowRight size={16} />
            </Button>
          </form>
          <p className="mt-3 text-xs text-[var(--foreground-muted)]">
            No spam. We will only reach out when your access is ready.
          </p>
        </motion.div>
      </div>
    </section>
  );
}
