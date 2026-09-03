# Design Document

**Feature:** Counter Agent Wallet  
**Version:** 3.1  
**Status:** Proposed pre-Gate-A executable design  
**Requirements:** `.kiro/specs/counter-agent-wallet/requirements.md`  
**Foundation:** `.kiro/specs/counter-platform-foundation/design.md`  
**Merchant contract:** `.kiro/specs/counter-merchant-agent/design.md`

## Overview

Counter Agent Wallet is a hosted policy/evidence control plane paired with a local agent signer and MCP server. The hosted service stores buyer policy, public identity, mandates, opaque payment references, transaction metadata, claims, findings, and receipts. The local process owns the agent private key, performs final policy prechecks, signs purchase intents, and exposes a narrow tool surface to compatible AI hosts.

The model never receives the private key, provider secret, reusable payment token, policy mutation capability, or authority to assert an external outcome. The Wallet contains no money or stored-value balance.

## Architecture

```text
Human Principal
   │ browser authentication / step-up / approval
   ▼
Wallet Console ───────> Wallet Control Plane API
                              │
                     policy / consent / mandates
                     public keys / revocations
                     transaction inbox / receipts
                              │
                    signed CTP artifacts only
                              │
AI Host ── stdio MCP ─> Local Wallet MCP + Signer
                              │
                       SecureKeyStore
                       local policy cache
                       intent signer/scheduler
                              │ authenticated Native API
                              ▼
                      Merchant Agent Runtime
                              │
                   Shopify / test payment provider
                   or Razorpay hosted user action
```

The local process is a client of hosted Counter APIs, not a privileged database/service. Native non-MCP agents may implement the same CTP/Native contracts with their own key custody.

## Approved topology and pilot boundaries

| Concern | Design |
|---|---|
| Hosted data | account, policy, consent, public keys, mandates, opaque test references, claims, receipts |
| Local secrets | agent private key and local device refresh credential through `SecureKeyStore` |
| MCP transport | local stdio remains supported for buyers who prefer it (`apps/local-mcp`, unchanged); **as of Phase 3, a remote Streamable-HTTP MCP transport (`apps/remote-mcp`) is also available and is the primary onboarding path** — see "Remote MCP transport and key custody" below for the reversal and its mitigations |
| Human auth | hosted identity-provider boundary with step-up; provider selected at Gate A |
| Principal consent | hosted Wallet service attestation after authenticated step-up, with assurance/evidence |
| Agent intent | signed locally by registered agent key |
| Autonomous payment test | Counter test authorization/provider only |
| Razorpay test | structured human `PAYMENT_ACTION_REQUIRED`; no OTP/PIN automation |
| Time trigger | local scheduler while signer is running, only if mandate explicitly allows it |
| Deployment | hosted APIs/console use foundation AWS target; local signer needs no AWS credentials |

Official MCP SDK documentation describes local stdio as a supported transport and TypeScript servers exposing tools/resources. The exact SDK/profile is selected and pinned during implementation rather than inferred from a moving “latest” version: [MCP TypeScript SDK](https://ts.sdk.modelcontextprotocol.io/). Content is summarized for compliance. The same SDK also ships a Streamable HTTP server transport and a full OAuth 2.1 authorization-server toolkit — the remote transport described below builds on that same pinned SDK, not a separate one.

## Components and Interfaces

```text
apps/
  wallet-console/          Next.js principal UI
  control-plane-api/       Wallet account/policy/approval routes
  local-mcp/               stdio MCP server, local signer, scheduler

packages/
  wallet-domain/           Wallet/agent/policy/approval/claim entities
  wallet-application/      hosted use cases
  wallet-contracts/        API/tool/resource schemas
  wallet-client/           typed hosted/runtime client
  local-signer/            key store, pairing, CTP signing
  mcp-adapter/             MCP projection and hard-denied capabilities
  receipt-verifier/        local receipt verification/projection
```

Wallet packages consume foundation CTP, authorization, policy, contracts, evidence, and observability. They do not import Shopify or Razorpay implementation packages.

## Identity and consent model

### Human principal

The principal authenticates to the hosted Wallet through the selected pilot identity provider. High-impact operations require recent step-up. The pilot does not pretend that a normal login is a direct cryptographic principal signature.

After step-up, the Wallet service issues a signed CTP `counter.principal-consent-attestation.v1` artifact. It records:

- principal and Wallet IDs;
- exact policy/mandate digest;
- authentication provider, method, assurance, and time;
- consent text/version;
- audience, expiry, nonce, and revocation locator.

After validating that attestation and its policy digest, the Wallet issuer creates a separate signed mandate envelope that references the attestation digest. The attestation and mandate are linked but not interchangeable, and neither is a direct principal cryptographic signature.

The attestation assurance states only that Counter witnessed authenticated principal consent. That assurance class survives normalization, policy, receipts, APIs, and UI projections and SHALL NOT satisfy a rule requiring direct principal, WebAuthn, or external-protocol proof. A later WebAuthn/AP2/external principal-signature adapter may provide stronger evidence without changing the normalized mandate model.

### Consent and transaction-data disclosure

Before mandate consent and before any interactive transaction approval or hosted payment action, the Wallet renders a deterministic, audience-specific projection of the data that the Counter Merchant, Shopify, selected test payment provider, and Counter services will receive. The projection identifies required field categories, purpose, destination, and applicable retention class without exposing payment or signing secrets. Consent/approval evidence binds the projection digest; any expanded recipient or field set is a material change that invalidates the approval. Autonomous execution may disclose only the pre-consented categories and the exact fields required by the bound intent.

### Agent identity

The local signer generates an Ed25519 keypair through `SecureKeyStore`, retaining the private key locally. It creates a proof-of-possession registration request. Hosted Counter stores the public key and issues a signed agent registration certificate with stable Agent URI, Wallet/principal binding, environment, assurance, and revocation locator.

Display name, model vendor, and AI host are labels—not cryptographic identity.

### Device pairing

1. Local signer generates key and short-lived pairing request containing public key/digest and one-time verifier.
2. It opens/displays a Wallet Console pairing URL/code.
3. Principal authenticates, reviews key/host/device metadata, and approves with step-up.
4. Hosted service atomically consumes the pairing request, registers key, and issues a scoped device credential plus registration certificate.
5. Local process stores device credential in `SecureKeyStore`; one-time material expires and cannot replay.

The pairing token grants registration only, never transaction authority.

## SecureKeyStore

```ts
interface SecureKeyStore {
  createAgentKey(label: string): Promise<PublicKeyDescriptor>;
  sign(keyId: string, bytes: Uint8Array, userPresence?: boolean): Promise<Signature>;
  getPublicKey(keyId: string): Promise<PublicKeyDescriptor>;
  revokeLocal(keyId: string): Promise<void>;
  storeDeviceCredential(ref: string, secret: Uint8Array): Promise<void>;
  loadDeviceCredential(ref: string): Promise<Uint8Array | null>;
}
```

The API does not expose private-key export. Windows secure storage is the first implementation; macOS Keychain and Linux Secret Service are separate adapters before broad distribution. Process memory is minimized/zeroed where supported. Debug logs and crash reports never include key or credential bytes.

If a device is lost, recovery revokes the public key, mandates, and device credential; the private key is not recovered from Counter. A new key/device is registered.

## Remote MCP transport and key custody (Phase 3 — reversal, decided and documented here)

**This is a genuine reversal of this document's original principle** ("local stdio by default; no
unauthenticated network listener", Security and privacy section below) — recorded explicitly, not
silently contradicted. The founder decided in principle that the buyer must only ever connect to
one thing — the Counter remote MCP URL — ruling out a "read-only remote, purchases stay local"
hybrid that would keep private keys client-side. That means signing keys move server-side. This
section records the concrete custody mechanism chosen to implement that decision, the alternatives
considered, and the accepted residual risk.

### Decision: HashiCorp Vault Transit engine, self-hosted on Fly

**Chosen:** HashiCorp Vault, Transit secrets engine, `ed25519` key type, run as a new Fly app
(`apps/remote-mcp`'s only trusted collaborator for signing — no other service holds a Vault token
with signing rights).

**Confirmed by real execution, not documentation reading** (per this repo's own source-of-truth
hierarchy in `CLAUDE.md` — this codebase has a documented history of static claims about
crypto/wiring turning out wrong): a real Vault 1.17.6 binary was run locally in dev mode, an
`ed25519` Transit key was created with `exportable=false` (the private key can never leave Vault
through any API call), a message was signed through Vault's `transit/sign` HTTP endpoint, and the
resulting 64-byte signature was verified successfully using the exact `@noble/ed25519`
`verifyAsync()` call this repo's own `packages/trust-protocol/src/verify.ts` uses to check CTP
envelopes — confirming Vault's Ed25519 output is bit-compatible with the app's existing verification
path with no format translation needed. A tampered-message negative control correctly failed
verification.

**Alternatives considered and why they weren't chosen:**

- **AWS Cloud KMS.** `docs/architecture/adr/0006-signing-key-boundaries.md` (Accepted, 2025-02-15)
  names AWS KMS + Secrets Manager as the default for production signing infrastructure — but that
  ADR inherits its AWS assumption from `docs/architecture/adr/0009-aws-pilot-target.md`, which
  specified AWS `ap-south-1` (ECS Fargate, RDS, KMS) as the pilot target. **That target was never
  actually realized: the system that is actually running today is deployed to Fly.io with Supabase
  Postgres** (confirmed directly — `fly.worker.toml`, `fly.control-plane-api.toml`,
  `fly.agent-runtime.toml` exist; no Terraform/OpenTofu state, AWS credentials, or AWS CLI exist
  anywhere in this environment). Flagging this per `CLAUDE.md`'s instruction to surface — not
  silently resolve — a conflict between a canonical document (ADR-0006) and the running system: ADR
  0006/0009's AWS assumption is stale relative to actual deployed infrastructure and should be
  revisited as its own item, separate from this phase. Introducing AWS KMS here would mean
  provisioning an entirely new cloud account/credential set this stack doesn't otherwise touch,
  purely for this one purpose.
- **GCP Cloud KMS.** Same objection the original Phase 3 plan raised: a new cloud provider this
  stack doesn't use anywhere else today. No GCP account or credentials exist in this environment
  either.
- **Vault wins on fit, not just elimination:** it runs on the infrastructure already in active use
  (Fly, already authenticated in this environment) with no new external account/billing
  relationship, and its `ed25519` Transit support was the one directly confirmed by execution above.

### Residual risk: self-hosted Vault means Counter, not a cloud provider, owns unseal/availability

A managed KMS (AWS/GCP) durably protects its own root key material and handles unseal transparently.
A self-hosted Vault instance's Shamir unseal key(s) are Counter's own operational responsibility: if
the Vault Fly VM restarts, it comes back **sealed** and the remote-mcp app's signing capability (and
therefore every buyer's ability to transact through the remote connector) is unavailable until
someone runs `vault operator unseal`. This is the accepted trade-off of not depending on a second
cloud provider. Mitigations:

- Small unseal threshold appropriate to a solo-founder pilot (not a large enterprise Shamir split);
  unseal key material is held outside this repository and outside any service that itself depends on
  Vault being unsealed (i.e., not stored as a Fly secret on the Vault app itself).
- Vault's audit log records every sign operation (buyer/tenant key id, timestamp, requester) —
  auditable per ADR-0006's "key operations are auditable" requirement.
- The Vault token held by `apps/remote-mcp` is scoped to a least-privilege policy: `sign`/`verify`
  under `transit/*` and key-creation for provisioning new buyer keys only — never `transit/keys/*`
  export, never Vault's own root/management capabilities.
- Blast radius of a compromised remote-mcp Vault token is bounded by the **existing, independent**
  defense-in-depth layers this platform already has: per-buyer key isolation (one Transit key per
  buyer, not one shared key), spend ceilings and merchant allowlists enforced by `checkMandateAuthority`
  and `createProductionPolicy` (unchanged by this phase — signing a bad intent still can't spend past
  policy), real-time balance checks at debit time, and instant mandate revocation.
- A Vault outage degrades to "no new signatures" (fail closed), not "signatures with a stale or wrong
  key" — Vault returns an error, not silently-wrong output, when sealed or when a key is revoked.

### Multi-tenant key resolution

The existing `SecureKeyStore` interface (`packages/wallet-domain/src/secure-key-store.ts`) is
single-owner — one store, one passphrase-derived unlock, matching one stdio process per buyer. It is
**not reused as-is** for the remote transport; a new `VaultSecureKeyStore` is added
(`packages/wallet-domain`) implementing a multi-tenant shape that threads a buyer/tenant identifier
through key resolution per authenticated request, backed by one Vault Transit key per buyer (key
name derived from the buyer's stable wallet/agent id, never a shared key). The existing
`FileSecureKeyStore`/`InMemorySecureKeyStore` are untouched and remain what `apps/local-mcp` uses for
buyers who keep the local-stdio model.

## Data Models

Hosted pilot entities:

```text
WalletAccount
PrincipalReference
WalletInvite
AgentRegistration
PublicKeyRecord
DeviceRegistration
BuyerPolicy + PolicyVersion
PrincipalConsentAttestation
Mandate
ApprovalTask + ApprovalDecision
Revocation
PaymentAuthorizationReference
TriggerDefinition
WalletTransaction
AgentClaim
MerchantObservationReference
ProviderObservationReference
FindingProjection
ReceiptProjection
RecoverySession
Export/ClosureJob
```

Payment references are opaque/test-scoped. No balance, ledger of held funds, PAN/CVV/UPI PIN/bank credential, or private key is modeled.

Wallet records use separate scope/RLS from merchants. Cross-side transaction joins occur only through a transaction/counterparty binding and audience projection.

## Buyer policy

The Wallet Console creates immutable policy versions supporting:

- exact Counter merchant IDs and verified domains;
- merchant legal/settlement and delivery countries;
- category/SKU restrictions;
- INR only for pilot;
- per-transaction, rolling 24-hour, quantity, and count limits;
- allowed operations and payment-reference classes;
- user-prompt and optional local time triggers;
- approval threshold and material-change behavior;
- validity and emergency stop.

“India only” evaluates signed merchant legal/settlement metadata plus delivery country, never IP/TLD alone.

### Hosted and local enforcement

Hosted shared Policy Engine is authoritative for Counter execution. The local signer also verifies the signed current policy/mandate and performs a conservative precheck before signing. If local and hosted results disagree, the most restrictive outcome wins. An expired/stale policy cache fails closed for consequential tools but may allow safe reads.

Cumulative limits are reserved atomically on the hosted service. Local counters are advisory defense-in-depth, not the sole control.

## Mandate lifecycle

1. Principal configures policy in Wallet Console.
2. Server computes exact version/digest and displays plain-language effects.
3. Principal step-up approves consent.
4. Wallet issuer creates a signed bounded mandate referencing policy, agent key, merchant scope, limits, operations, trigger types, approval rule, opaque payment reference, expiry, nonce, and revocation.
5. Local signer fetches/verifies the mandate and stores only the signed artifact/cache.
6. Every intent references the current mandate and local agent key.
7. Policy widening creates a new version/mandate; narrowing or emergency revocation blocks future effects immediately after durable acceptance.

The agent/MCP cannot create, approve, widen, or choose a new payment reference.

## Agent transaction flow

### Discovery and quote

The local MCP calls hosted/runtime APIs for signed merchant capabilities, search, product detail, and quote. It verifies environment, merchant/domain, India metadata, released operations, limitations, quote digest/signature/expiry, and local policy before presenting results to the model.

### Proposal and intent

`propose_purchase` takes structured item/quantity/destination requirements. It obtains a quote but creates no external effect. It returns exact totals, expiry, policy result, approval requirement, reservation limitation, and a proposal ID.

`execute_purchase` requires the proposal/quote and an explicit model call representing the user's request or an eligible local trigger. The signer:

1. reloads current signed policy/mandate/revocation;
2. verifies quote/material fields and trigger permission;
3. creates a CTP purchase intent and stable idempotency key;
4. signs locally;
5. submits to Merchant Runtime;
6. returns structured transaction state.

The model cannot supply a different merchant/amount after signing.

### Approval

If policy returns review-required, the hosted service creates an approval task bound to exact intent/quote/transaction version and expiry. MCP returns `REVIEW_REQUIRED` plus a safe Wallet Console link/ID. The principal approves/denies through step-up. The local tool may poll/read status but cannot approve itself.

### Autonomous Counter test-provider path

If a signed mandate allows the operation/trigger and no approval is required, the Merchant Runtime may complete the deterministic Counter test payment and Shopify test order without a new human action. The result remains visibly `test_only`.

### Razorpay test path

The transaction returns `PAYMENT_ACTION_REQUIRED` with a short-lived hosted action. The local MCP may open or display the URL only after user interaction; it never fills OTP/PIN/payment details. After the human completes Standard Checkout, the model/tool polls structured state while server-side provider evidence and Shopify workflow resolve. This path is not described as unattended autonomy.

## MCP profile

The pilot MCP server uses local stdio. Every tool has strict input/output schemas, side-effect annotation/documentation, bounded timeout, safe error states, and stable idempotency behavior.

### Read tools

```text
counter_wallet_status
counter_list_merchants
counter_search_products
counter_get_product
counter_get_quote
counter_get_transaction
counter_list_pending_actions
counter_verify_receipt
```

### Consequential tools

```text
counter_propose_purchase     # no external commercial effect
counter_execute_purchase     # signs/submits exact approved proposal
counter_cancel_transaction   # policy/state dependent
counter_request_refund       # proposal/request; policy/state dependent
```

No MCP tools exist for key export, policy mutation, merchant allowlisting, limit widening, payment-reference changes, principal approval, recovery, or settlement assertion.

## Error Handling

Tool and API results use canonical states such as `DENIED`, `REVIEW_REQUIRED`, `PAYMENT_ACTION_REQUIRED`, `PENDING`, `INDETERMINATE`, `CONFIRMED`, and `FAILED_REQUIRES_ACTION`. The adapter never turns pending/unknown into success text.

### Prompt-injection boundary

Merchant/product text and external error messages are untrusted data. They are returned as data fields, never interpreted by the MCP server as instructions. Tool descriptions state that external content cannot authorize policy/key/payment changes. Inputs are validated independently of model prose.

## Time-triggered autonomy

A `TriggerDefinition` is created only through the Wallet Console and bound to a policy/mandate, operation template, merchant scope, schedule/window, maximum executions/value, and expiry. The local scheduler:

- runs only while the local service is active;
- fetches current signed trigger/policy/mandate and merchant quote;
- signs a fresh intent only if every bound still passes;
- deduplicates each scheduled occurrence;
- stops on revocation, stale policy, material change, review-required, payment action, or unknown state;
- never runs hosted with the user's agent private key.

Pilot time triggers use the Counter test provider only. Razorpay Standard Checkout cannot be completed by a background trigger.

## Claim ledger and evidence

The local/hosted Wallet records source-labelled claims:

- model request and normalized proposal digest;
- local precheck and signed-intent digest;
- hosted policy decision;
- Merchant Runtime state;
- provider/Shopify evidence references;
- findings and receipt versions.

Agent claims are never authoritative payment/order proof. Hosted receipt projections are verified locally before display. Invalid signature, wrong audience, broken digest/supersession, or unknown key marks the receipt untrusted and creates/escalates a finding.

## Wallet Console

Pilot screens:

1. invite/enrollment and non-custodial disclosure;
2. device/local signer pairing and agent registrations;
3. merchant/domain and India allowlists;
4. category/SKU, INR, rolling/count, time, operation, and approval policy;
5. test payment-reference selection/status;
6. mandate preview, step-up consent, active versions, and revocation;
7. approval/payment-action inbox;
8. transaction/claim/evidence timeline;
9. findings and independently verified receipts;
10. trigger configuration/status;
11. security events, devices, key rotation/revocation, recovery lock;
12. export, suspension, and closure.

The console never displays a Counter balance or top-up control.

## Native API client and optionality

MCP is an adapter, not a requirement for all agents. Counter publishes Native contracts and CTP signing requirements so an external agent can:

- register its own public key through an approved Wallet flow;
- obtain a principal-approved mandate;
- sign intents using its own secure key boundary;
- invoke the same runtime operations;
- verify receipts.

Such clients receive no weaker policy and cannot use undocumented headers or bypass Wallet controls.

## Authentication and sessions

- Human web sessions use the selected provider and short-lived server sessions; high-impact operations require step-up.
- Local device authorization uses a scoped, revocable credential stored in `SecureKeyStore`; it is distinct from the agent signing key.
- Local credential scopes allow read/sign-submit/status only for one Wallet/device/environment and never policy/recovery/approval mutation.
- API access tokens are short-lived; refresh/device credentials rotate and revoke.
- Pairing/recovery/export/closure are rate-limited and generate independent notifications/audit.

## Recovery, revocation, export, and closure

Recovery locks new effects, verifies the principal through a separate stepped-up flow, revokes affected device/agent keys/mandates, and registers a new device/key. Counter cannot restore the lost private key.

Emergency stop supports Wallet, device, agent, key, mandate, trigger, and payment-reference scopes. Revocation is monotonic and checked immediately before effects.

Export includes documented policy, public identities, mandates, approvals, claims, receipts, and revocations without secrets. Closure disables new actions first, resolves/openly lists committed obligations, revokes access, schedules deletion/anonymization, and issues a closure receipt.

## Security and privacy

Threats include compromised AI host, prompt injection, malicious MCP client, local malware, key-store extraction, device pairing interception, confused deputy, replay, policy-cache rollback, approval phishing, merchant correlation, recovery takeover, and support abuse.

Controls include:

- local stdio remains available for buyers who choose it; **as of Phase 3, the primary path is a
  remote MCP transport with server-side, KMS-backed signing** — see "Remote MCP transport and key
  custody" above for the reversal, the concrete mitigations, and why this is still not a bare
  unauthenticated listener (OAuth 2.1-gated, per-buyer key isolation, unchanged policy/limit
  enforcement);
- if a loopback callback is used, random path/state, one-time verifier, strict host/origin, and DNS-rebinding protections;
- OS secure storage and non-exporting application interface;
- signed current policy/mandate and monotonic revocation checks;
- hard-coded absence/denial of policy/key/payment-secret MCP operations;
- transaction/material digest confirmation;
- short-lived pairing/action links;
- minimal pairwise IDs and merchant disclosure;
- redacted telemetry and crash handling;
- rate limits/anomaly/kill switches;
- no external content treated as executable instruction.

## Observability

Hosted metrics cover enrollment/pairing, active/revoked agents, policy decisions, approval latency, local client versions, transaction states, payment-action completion, receipt verification, recovery, and security anomalies. Local logs default to minimal metadata, redact tool arguments containing personal data, never include signatures/credentials/keys, and support user-visible diagnostics export.

## Correctness Properties

### Property 1: Wallet authority and custody invariants

The executable Wallet properties are W1–W14 in the requirements: isolation, local key custody, non-custody, bilateral authority intersection, exact consent, atomic limits, monotonic revocation, at-most-one effect, provider truth, explicit uncertainty, model containment, evidence integrity, verified India scope, and capability honesty. Assurance non-inflation and disclosure-digest binding are additional required negative properties inherited from the foundation and Wallet requirements.

## Testing Strategy

- `SecureKeyStore` contract and Windows implementation tests;
- process/memory/log/telemetry no-key/no-credential checks;
- pairing expiry/replay/interception and proof-of-possession tests;
- human authentication/step-up/consent assurance tests;
- policy version/intersection/rolling-limit/revocation concurrency tests;
- MCP schema/tool allowlist and forbidden-tool tests;
- malicious model prompt and untrusted merchant-content tests;
- proposal/quote/material-change/idempotency tests;
- approval expiry/self-approval/bypass tests;
- autonomous Counter test-provider purchase and scheduled occurrence;
- Razorpay structured human-action flow without OTP/PIN automation;
- claim versus provider/merchant truth and receipt verification;
- lost device/recovery/key rotation/export/closure;
- independent Native client compatibility.

## Requirement traceability

| Wallet requirement area | Design |
|---|---|
| Lifecycle/isolation/auth/recovery | hosted account, sessions, recovery/closure |
| Agent identity/key custody | pairing, SecureKeyStore, registration |
| Buyer policy/mandates | policy model, consent attestation, mandate lifecycle |
| Payment boundary | opaque references and split test/provider paths |
| MCP safety | explicit tool profile and hard-denied operations |
| Transaction flow | proposal, local intent signing, approval/action states |
| Claim/evidence/receipts | claim ledger and local verification |
| Privacy/security/operations | pairwise disclosure, controls, telemetry, tests |

## Gate A decisions

Before Wallet implementation is called complete, record:

1. exact MCP protocol/TypeScript SDK version, stdio behavior, tool annotations, and supported host matrix;
2. pilot human identity provider, invitation, session, and step-up method;
3. Windows secure-store implementation and assurance limitations;
4. principal-consent attestation wording/assurance and future direct-signature migration;
5. local process packaging, update signing, diagnostics, and uninstall/key-removal behavior;
6. browser handoff/loopback mechanism for pairing, approvals, and Razorpay action;
7. supported first AI host(s) for private pilot certification.
