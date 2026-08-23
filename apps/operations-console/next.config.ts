import type { NextConfig } from "next";

/**
 * apps/operations-console
 *
 * Separately authorized Next.js Operations console shell. Real
 * fleet/incident/queue/kill-switch surfaces are implemented in task 15.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
