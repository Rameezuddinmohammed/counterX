"use client";

import { motion } from "framer-motion";
import { Wallet, Shield, Zap, Network, Lock, BarChart3 } from "lucide-react";

const FEATURES = [
  {
    icon: Wallet,
    title: "AI Agent Wallets",
    description:
      "Programmable wallets purpose-built for AI agents with spending limits, category controls, and real-time balance tracking.",
  },
  {
    icon: BarChart3,
    title: "Merchant Control Plane",
    description:
      "Complete merchant lifecycle management from onboarding through activation, with policy simulation and readiness checks.",
  },
  {
    icon: Shield,
    title: "Trust Protocol",
    description:
      "Cryptographic evidence chains and trust scoring that let agents and merchants transact with confidence and accountability.",
  },
  {
    icon: Zap,
    title: "Real-time Transactions",
    description:
      "Sub-100ms transaction processing with instant settlement, live event streams, and comprehensive audit trails.",
  },
  {
    icon: Lock,
    title: "Policy Engine",
    description:
      "Declarative policy rules that govern every transaction. Category allowlists, spending limits, time windows, and custom constraints.",
  },
  {
    icon: Network,
    title: "Commerce Graph",
    description:
      "A unified graph connecting agents, merchants, products, and transactions for intelligent discovery and routing.",
  },
] as const;

const containerVariants = {
  hidden: { opacity: 0 },
  visible: {
    opacity: 1,
    transition: { staggerChildren: 0.1 },
  },
};

const itemVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0, transition: { duration: 0.5 } },
};

export function Features() {
  return (
    <section id="features" className="relative py-24 sm:py-32">
      <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
        {/* Section header */}
        <div className="text-center mb-16">
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            className="text-sm font-medium text-orange-500 uppercase tracking-wider mb-3"
          >
            Capabilities
          </motion.p>
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.1 }}
            className="text-3xl sm:text-4xl font-bold tracking-tight mb-4"
          >
            Everything AI agents need to transact
          </motion.h2>
          <motion.p
            initial={{ opacity: 0, y: 10 }}
            whileInView={{ opacity: 1, y: 0 }}
            viewport={{ once: true }}
            transition={{ delay: 0.2 }}
            className="mx-auto max-w-2xl text-[var(--foreground-secondary)] text-lg"
          >
            A complete commerce stack designed from the ground up for autonomous agents, with the
            controls merchants and users demand.
          </motion.p>
        </div>

        {/* Feature grid */}
        <motion.div
          variants={containerVariants}
          initial="hidden"
          whileInView="visible"
          viewport={{ once: true, margin: "-100px" }}
          className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6"
        >
          {FEATURES.map((feature) => (
            <motion.div
              key={feature.title}
              variants={itemVariants}
              className="group relative rounded-xl border border-[var(--border)] bg-[var(--surface)]/50 p-6 backdrop-blur-sm transition-all hover:border-orange-500/30 hover:bg-[var(--surface)]"
            >
              {/* Icon */}
              <div className="mb-4 flex h-10 w-10 items-center justify-center rounded-lg bg-orange-500/10 text-orange-500 transition-colors group-hover:bg-orange-500/20">
                <feature.icon size={20} />
              </div>

              {/* Content */}
              <h3 className="text-lg font-semibold mb-2">{feature.title}</h3>
              <p className="text-sm text-[var(--foreground-secondary)] leading-relaxed">
                {feature.description}
              </p>

              {/* Hover glow */}
              <div className="absolute inset-0 rounded-xl opacity-0 transition-opacity group-hover:opacity-100 pointer-events-none">
                <div className="absolute inset-0 rounded-xl bg-gradient-to-br from-orange-500/5 to-transparent" />
              </div>
            </motion.div>
          ))}
        </motion.div>
      </div>
    </section>
  );
}
