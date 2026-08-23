# ADR-0001: Enforce modular-monolith boundaries

- **Status:** Accepted
- **Date:** 2025-02-15
- **Requirements:** 1, 15

## Decision

Use a strict TypeScript pnpm workspace with deployable `apps/*` and shared `packages/*`. Applications and adapters depend inward on application services, contracts, and domain ports. `domain` has no imports from Fastify, Next.js, database drivers, AWS, providers, MCP, or adapters. `contracts`, `trust-protocol`, `authorization`, `policy`, `workflow`, `data`, `evidence`, `connector-sdk`, `payment-sdk`, `observability`, `config`, and `testkit` remain separate packages as defined in the foundation design.

Dependency Cruiser checks the import graph and circular dependencies in CI. Database and external-service implementations are adapters; domain packages never import them.

## Consequences

Shared semantics are not forked by Merchant or Wallet products. More packages and explicit ports are required, but deployables can split later without changing domain contracts.
