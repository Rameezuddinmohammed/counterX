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
  async rewrites() {
    const target =
      process.env["CONTROL_PLANE_API_URL"] ?? "https://counter-control-plane-api.fly.dev";
    return [
      {
        source: "/control/v1/:path*",
        destination: `${target}/control/v1/:path*`,
      },
    ];
  },
};

export default nextConfig;
