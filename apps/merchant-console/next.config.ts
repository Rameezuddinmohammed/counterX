import type { NextConfig } from "next";

/**
 * apps/merchant-console
 *
 * Next.js Merchant console with @counter/ui components,
 * Auth0 integration, and real API wiring.
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@counter/ui"],
};

export default nextConfig;
