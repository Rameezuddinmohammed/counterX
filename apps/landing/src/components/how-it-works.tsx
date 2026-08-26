"use client";

import { motion } from "framer-motion";
import { Search, ShieldCheck, CreditCard } from "lucide-react";

const STEPS = [
  {
    number: "01",
    icon: Search,
    title: "Agent discovers products",
    description:
      "AI agents browse the Commerce Graph to find products and services that match user intent, with rich metadata and merchant trust scores.",
  },
  {
    number: "02",
    icon: ShieldCheck,
    title: "Policy engine approves",
    description:
      "Every transaction passes through the policy engine: spending limits, category rules, time windows, and custom constraints are evaluated in real time.",
  },
  {
    number: "03",
    icon: CreditCard,
    title: "Secure transaction executes",
    description:
      "Approved transactions settle instantly with cryptographic evidence, complete audit trails, and real-time notifications to all parties.",
  },
] as const;

export function HowItWorks() {
  return (
    <section id="how-it-works" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="text-center mb-16">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-sm font-medium text-orange-500 uppercase tracking-wider mb-3"
          >
            How It Works
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-3xl sm:text-4xl font-bold tracking-tight mb-4"
          >
            Three steps to autonomous commerce
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="mx-auto max-w-2xl text-[var(--foreground-secondary)] text-lg"
          >
            From discovery to settlement, Counter handles the entire transaction
            lifecycle with security at every step.
          </motion.p>
        </div>

        {/* Steps */}
        <div className="relative">
          {/* Connecting line */}
          <div className="absolute left-1/2 top-0 bottom-0 w-px bg-gradient-to-b from-orange-500/0 via-orange-500/30 to-orange-500/0 hidden lg:block" />

          <div className="grid grid-cols-1 lg:grid-cols-3 gap-8 lg:gap-12">
            {STEPS.map((step, index) => (
              <motion.div
                key={step.number}
                initial={{ opacity: 0, y: 20 }}
                whileInView={{ opacity: 1, y: 0 }}
                viewport={{ once: true }}
                transition={{ delay: index * 0.15, duration: 0.5 }}
                className="relative text-center lg:text-left"
              >
                {/* Step number */}
                <div className="mb-4 flex items-center justify-center lg:justify-start gap-3">
                  <span className="text-xs font-mono text-orange-500 bg-orange-500/10 rounded-full px-3 py-1">
                    {step.number}
                  </span>
                </div>

                {/* Icon */}
                <div className="mx-auto lg:mx-0 mb-4 flex h-12 w-12 items-center justify-center rounded-xl border border-orange-500/20 bg-orange-500/5 text-orange-500">
                  <step.icon size={24} />
                </div>

                {/* Content */}
                <h3 className="text-xl font-semibold mb-2">{step.title}</h3>
                <p className="text-sm text-[var(--foreground-secondary)] leading-relaxed">
                  {step.description}
                </p>
              </motion.div>
            ))}
          </div>
        </div>
      </div>
    </section>
  );
}
