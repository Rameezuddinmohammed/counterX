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
- BigInt serialization requires a preSerialization hook since Fastify's default JSON serializer cannot handle bigint values from the connector's catalog (priceMinor) and actions (totalMinor)
- exactOptionalPropertyTypes requires careful construction of payload objects to avoid assigning undefined to optional properties
- Route order matters for Fastify - /products/search must be registered before /products/:id to avoid conflicts
