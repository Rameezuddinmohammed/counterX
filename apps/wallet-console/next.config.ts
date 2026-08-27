import type { NextConfig } from "next";

/**
 * apps/wallet-console
 *
 * Next.js Wallet console with @counter/ui components,
 * Auth0 integration, and real API wiring.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@counter/ui"],
  typescript: { ignoreBuildErrors: true },
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
