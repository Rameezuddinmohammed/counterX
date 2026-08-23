# FEAT-001: Implement signed receipts and independent verifier

## Status: completed

## Description
Implement signed transaction receipts with canonical commitments, audience-scoped projections (merchant/wallet), CTP envelope signing, an append-only receipt store, and a dependency-light independent verifier.

## Files created
- packages/evidence/src/receipt-types.ts
- packages/evidence/src/receipt-commitment.ts
- packages/evidence/src/receipt-store.ts
- packages/evidence/src/receipt-issuance.ts
- packages/evidence/src/receipt-verifier.ts
- packages/evidence/src/receipt.test.ts

## Files modified
- packages/evidence/src/index.ts
- packages/evidence/package.json
- pnpm-lock.yaml

## Acceptance Criteria (all met)
- Canonical commitment produces deterministic SHA-256 digest via RFC 8785
- Merchant and wallet views of same transaction produce same commitment digest
- Merchant view redacts wallet-private fields
- Wallet view redacts merchant-private fields
- Receipts are signed CTP envelopes
- Independent verifier validates signature, audience, digest integrity
- Wrong key fails verification
- Tampered content fails verification
- Supersession chain is tracked and verifiable

## Findings
- pnpm install requires --config.engine-strict=false due to Node version mismatch (22.23.2 vs 22.14.0)
- exactOptionalPropertyTypes requires careful conditional assignment for optional fields rather than assigning undefined
- Added @noble/ed25519 and json-canonicalize as direct dependencies of evidence package (for the independent verifier)
