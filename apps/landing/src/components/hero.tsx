"use client";

import { Button } from "@counter/ui";
import { motion } from "framer-motion";
import { ArrowRight, BookOpen } from "lucide-react";

function AnimatedCube({
  delay,
  x,
  y,
  size,
  opacity,
}: {
  delay: number;
  x: string;
  y: string;
  size: number;
  opacity: number;
}) {
  return (
    <motion.div
      className="absolute preserve-3d"
      style={{ left: x, top: y }}
      initial={{ opacity: 0, rotateX: 0, rotateY: 0 }}
      animate={{
        opacity: [0, opacity, opacity, 0],
        rotateX: [0, 45, 90, 135],
        rotateY: [0, 45, 90, 135],
        y: [0, -20, -10, -30],
      }}
      transition={{
        duration: 8,
        delay,
        repeat: Infinity,
        ease: "easeInOut",
      }}
    >
      <div
        className="rounded-lg border border-orange-500/20"
        style={{
          width: size,
          height: size,
          background: `linear-gradient(135deg, rgba(249, 115, 22, ${opacity}) 0%, rgba(234, 88, 12, ${opacity * 0.5}) 100%)`,
          boxShadow: `0 0 ${size / 2}px rgba(249, 115, 22, ${opacity * 0.3})`,
        }}
      />
    </motion.div>
  );
}

function CubeGrid() {
  const cubes = [
    { delay: 0, x: "10%", y: "20%", size: 60, opacity: 0.6 },
    { delay: 1.2, x: "75%", y: "15%", size: 45, opacity: 0.4 },
    { delay: 0.5, x: "85%", y: "60%", size: 55, opacity: 0.5 },
    { delay: 2, x: "20%", y: "70%", size: 40, opacity: 0.3 },
    { delay: 1.8, x: "60%", y: "75%", size: 50, opacity: 0.4 },
    { delay: 0.8, x: "40%", y: "10%", size: 35, opacity: 0.3 },
    { delay: 2.5, x: "5%", y: "50%", size: 30, opacity: 0.25 },
    { delay: 1.5, x: "90%", y: "35%", size: 38, opacity: 0.35 },
    { delay: 3, x: "50%", y: "50%", size: 70, opacity: 0.2 },
    { delay: 0.3, x: "30%", y: "85%", size: 42, opacity: 0.3 },
    { delay: 2.2, x: "70%", y: "40%", size: 48, opacity: 0.35 },
    { delay: 1, x: "15%", y: "40%", size: 32, opacity: 0.25 },
  ];

  return (
    <div className="absolute inset-0 overflow-hidden perspective-1000">
      {cubes.map((cube, i) => (
        <AnimatedCube key={i} {...cube} />
      ))}
      {/* Central glow */}
      <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[600px] radial-glow-orange animate-glow-pulse pointer-events-none" />
    </div>
  );
}

export function Hero() {
  return (
    <section className="relative min-h-screen flex items-center justify-center overflow-hidden pt-16">
      {/* Background grid */}
      <div className="absolute inset-0 grid-background" />

      {/* Animated cubes */}
      <CubeGrid />

      {/* Content */}
      <div className="relative z-10 mx-auto max-w-5xl px-4 sm:px-6 lg:px-8 text-center">
        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.2 }}
          className="mb-6"
        >
          <span className="inline-flex items-center gap-2 rounded-full border border-orange-500/20 bg-orange-500/5 px-4 py-1.5 text-sm text-orange-400">
            <span className="h-1.5 w-1.5 rounded-full bg-orange-500 animate-pulse" />
            Now accepting early access partners
          </span>
        </motion.div>

        <motion.h1
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.3 }}
          className="text-4xl sm:text-5xl md:text-7xl font-bold tracking-tight leading-[1.1] mb-6"
        >
          The commerce layer
          <br />
          <span className="text-gradient-orange">for AI agents</span>
        </motion.h1>

        <motion.p
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.4 }}
          className="mx-auto max-w-2xl text-lg sm:text-xl text-[var(--foreground-secondary)] mb-10"
        >
          Counter provides the infrastructure for AI agents to discover products, execute
          transactions, and manage commerce autonomously with built-in trust, policy controls, and
          real-time settlement.
        </motion.p>

        <motion.div
          initial={{ opacity: 0, y: 20 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.6, delay: 0.5 }}
          className="flex flex-col sm:flex-row items-center justify-center gap-4"
        >
          <Button size="lg" className="gap-2 text-base px-8">
            Get Early Access
            <ArrowRight size={16} />
          </Button>
          <Button variant="outline" size="lg" className="gap-2 text-base px-8">
            <BookOpen size={16} />
            Read Docs
          </Button>
        </motion.div>
      </div>

      {/* Bottom fade */}
      <div className="absolute bottom-0 left-0 right-0 h-32 bg-gradient-to-t from-[var(--background)] to-transparent" />
    </section>
  );
}
