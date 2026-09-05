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
  // `typescript.ignoreBuildErrors` and the `eslint` key were both removed
  // here on 2026-09-05. The eslint key is no longer a valid Next config
  // option in this version and printed a warning on every single boot
  // ("Invalid next.config.ts options detected"); linting runs through
  // `pnpm lint` regardless. ignoreBuildErrors meant a type error shipped a
  // broken page to production instead of failing the build — the repo
  // already typechecks clean (`pnpm typecheck`), so there is nothing to
  // suppress and plenty to catch.
};

export default nextConfig;
