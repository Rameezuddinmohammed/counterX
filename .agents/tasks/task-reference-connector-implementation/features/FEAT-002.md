# FEAT-002: Implement apps/reference-services as a local Fastify REST server exposing the reference connector

## Status: completed

## Description
Implement the reference-services app as a local Fastify REST server that wraps the reference connector and exposes its capabilities through REST endpoints.

## Acceptance Criteria
- Fastify server factory function (buildServer) creates and configures the server
- All connector resources (products, variants) are exposed via REST GET endpoints
- All connector actions are exposed via REST POST endpoints
- Health, events, manifest, and fault-controls endpoints work correctly
- All tests pass using Fastify inject()
- TypeScript strict mode passes with no errors

## Findings
- Review fix pass addressed: HTTP status codes now reflect action outcomes (409 for failed, 202 for indeterminate, success code for succeeded), OrderRegistry wired into complete/cancel actions, fault-controls endpoint documented as full state reset, BigInt serialization hook documented.
- 14 tests pass in the services package.
