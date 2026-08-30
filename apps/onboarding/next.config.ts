import type { NextConfig } from "next";

/**
 * apps/onboarding
 *
 * Public signup/login site. No shared design system dependency —
 * deliberately minimal (see CLAUDE.md: test mode first, expand later).
 */
const nextConfig: NextConfig = {
  reactStrictMode: true,
};

export default nextConfig;
