# FEAT-002: Wire @counter/http-api-kit into control-plane-api and agent-runtime app shells

## Status: completed

## Description
Replace placeholder createServer() in both apps/control-plane-api and apps/agent-runtime with fully configured Fastify instances using createHttpServer from @counter/http-api-kit. Each app gets route boundary separation (control/v1, runtime/v1, webhooks/v1) and proper health/readiness endpoints.

## Steps Completed
- Updated apps/control-plane-api/package.json: added @counter/http-api-kit, @counter/authorization, @counter/domain as dependencies and jose as devDependency
- Rewrote apps/control-plane-api/src/index.ts: exports createServer() using createHttpServer with Auth0 config, OpenAPI in non-production, sample /control/v1/status protected route
- Updated apps/agent-runtime/package.json: same dependency additions
- Rewrote apps/agent-runtime/src/index.ts: same as control-plane plus webhookIngressPlugin for /webhooks/v1/{adapter}/* routes
- Updated apps/control-plane-api/src/index.test.ts: tests for health, readiness, auth rejection, authenticated access, OpenAPI spec
- Updated apps/agent-runtime/src/index.test.ts: tests for health, readiness, auth rejection, authenticated access, webhook ingress, OpenAPI spec
- Ran pnpm install to link workspace dependencies
- Verified both apps build (npx tsc --noEmit) and tests pass (npx vitest run)

## Acceptance Criteria Met
- apps/control-plane-api builds without TypeScript errors
- apps/control-plane-api tests pass (6 tests): health, readiness, auth rejection, authenticated access, OpenAPI, app identity
- apps/agent-runtime builds without TypeScript errors
- apps/agent-runtime tests pass (8 tests): health, readiness, auth rejection, authenticated access, webhook ingress, webhook 404, OpenAPI, app identity
- Both apps export createServer() producing configured Fastify instances

## Findings
- pnpm-lock.yaml regeneration required removing the file and re-running pnpm install since pnpm 9.15.4 cache was not detecting package.json changes.
- exactOptionalPropertyTypes requires conditional spread pattern for ServerFactoryOptions (cannot assign undefined to optional openApi field).
- webhookIngressPlugin options parameter cannot be undefined when passed to server.register; must default to empty object {}.
