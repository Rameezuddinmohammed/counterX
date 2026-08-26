"use client";

import { motion } from "framer-motion";
import type { ReactNode } from "react";

export interface PageWrapperProps {
  children: ReactNode;
  className?: string;
}

/**
 * Shared page entrance animation wrapper.
 * Applies a subtle fade-in + slide-up transition when a page mounts.
 */
export function PageWrapper({ children, className }: PageWrapperProps) {
  return (
    <motion.div
      initial={{ opacity: 0, y: 6 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3, ease: "easeOut" }}
      className={className}
    >
      {children}
    </motion.div>
  );
}
