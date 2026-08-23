# ADR-0008: Use an external OIDC identity provider behind an application boundary

- **Status:** Accepted
- **Date:** 2025-02-15
- **Requirements:** 1, 10, 14, 15

## Decision

Human and service authentication integrate with a selected standards-compliant OpenID Connect provider behind an identity adapter. The provider performs authentication, MFA/step-up, and session issuance; Counter owns principal/scoping interpretation, authorization, support grants, audit, and policy semantics. Provider claims are normalized into explicit `ActorContext` values and are never trusted from request bodies.

The concrete pilot provider is intentionally deferred to Gate A so deployment, residency, MFA, operational ownership, and cost can be evaluated without coupling domain packages to a vendor SDK.

## Consequences

The platform can replace identity vendors without changing authorization semantics. Privileged operations require verified step-up assurance and audit regardless of provider choice.
