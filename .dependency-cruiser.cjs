/**
 * Dependency-cruiser configuration enforcing ADR-0001 module boundaries.
 *
 * Rules:
 *  - packages/domain has zero imports from Fastify, Next.js, database drivers,
 *    AWS SDKs, MCP, or adapter code.
 *  - packages/* never depend on apps/* (dependency direction is inward: apps -> packages).
 *  - No circular imports anywhere in the workspace.
 *  - Merchant packages must not import from wallet-related packages or apps.
 *  - Merchant packages must not import database drivers or @counter/data internals directly.
 */

/** @type {import('dependency-cruiser').IConfiguration} */
module.exports = {
  forbidden: [
    {
      name: "no-circular",
      severity: "error",
      comment: "Circular imports are not allowed anywhere in the workspace.",
      from: {},
      to: { circular: true },
    },
    {
      name: "domain-no-framework-or-infra-imports",
      severity: "error",
      comment:
        "packages/domain must have zero imports from Fastify, Next.js, database drivers, AWS, providers, MCP, or adapters (ADR-0001).",
      from: { path: "^packages/domain" },
      to: {
        path: [
          "^fastify",
          "node_modules/fastify",
          "^next",
          "node_modules/next",
          "^pg",
          "node_modules/pg",
          "^drizzle-orm",
          "node_modules/drizzle-orm",
          "^drizzle-kit",
          "node_modules/drizzle-kit",
          "^aws-sdk",
          "node_modules/aws-sdk",
          "@aws-sdk",
          "node_modules/@aws-sdk",
          "@modelcontextprotocol",
          "node_modules/@modelcontextprotocol",
          "adapters",
        ],
      },
    },
    {
      name: "packages-do-not-depend-on-apps",
      severity: "error",
      comment:
        "Shared packages must not import from deployable apps; dependency direction is apps -> packages only.",
      from: { path: "^packages" },
      to: { path: "^apps" },
    },
    {
      name: "merchant-no-wallet-imports",
      severity: "error",
      comment:
        "Merchant packages must not import from wallet-related packages or apps.",
      from: {
        path: "^packages/(commerce-graph|merchant-application|merchant-policy|shopify-connector|reference-connector|razorpay-adapter|merchant-contracts)",
      },
      to: {
        path: ["^apps/wallet-console", "^packages/wallet"],
      },
    },
    {
      name: "merchant-no-direct-persistence",
      severity: "error",
      comment:
        "Merchant packages must not import database drivers or @counter/data internals directly.",
      from: {
        path: "^packages/(commerce-graph|merchant-application|merchant-policy|shopify-connector|reference-connector|razorpay-adapter|merchant-contracts)",
      },
      to: {
        path: [
          "^pg",
          "node_modules/pg",
          "^drizzle-orm",
          "node_modules/drizzle-orm",
          "^drizzle-kit",
          "node_modules/drizzle-kit",
          "^packages/data",
        ],
      },
    },
  ],
  options: {
    doNotFollow: {
      path: "node_modules",
    },
    tsPreCompilationDeps: true,
    tsConfig: {
      fileName: "tsconfig.base.json",
    },
    enhancedResolveOptions: {
      exportsFields: ["exports"],
      conditionNames: ["import", "require", "node", "default", "types"],
      extensions: [".ts", ".js", ".json"],
    },
    reporterOptions: {
      dot: {
        collapsePattern: "node_modules/[^/]+",
      },
    },
  },
};
