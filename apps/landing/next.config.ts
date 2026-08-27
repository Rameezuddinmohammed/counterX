import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  reactStrictMode: true,
  output: "export",
  transpilePackages: ["@counter/ui"],
};

export default nextConfig;
