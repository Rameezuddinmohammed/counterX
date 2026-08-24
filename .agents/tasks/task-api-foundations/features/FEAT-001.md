# FEAT-001: Create @counter/http-api-kit package

## Status: completed

## Description
Create a shared `@counter/http-api-kit` package with all Fastify middleware and utilities including:
- Correlation ID tracking
- Idempotency key extraction
- Error handler mapping CanonicalError to HTTP responses
- JWT authentication middleware (Auth0 RS256)
- Actor extraction from JWT claims
- Scope enforcement middleware
- Health check endpoints
- Webhook ingress (raw body preservation)
- OpenAPI generation
- Server factory

## Findings
- pnpm 9.15.4 required (project's packageManager field). pnpm 10.x does not detect workspace packages correctly.
- engine-strict=false must be set temporarily during install due to Node 22.23.2 vs 22.14.0 mismatch.
- Fastify 5 requires fastify-plugin wrapper for plugins that add hooks meant to apply globally (avoids encapsulation).
- exactOptionalPropertyTypes in tsconfig requires conditional spread patterns instead of passing undefined.
- In Fastify 5 onRequest hooks, returning `reply` after `reply.send()` is needed to short-circuit request processing.
