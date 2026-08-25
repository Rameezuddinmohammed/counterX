# Merchant Ownership Verification Methods

- **Status:** Accepted
- **Date:** 2025-02-20
- **Scope:** Typed verification methods for merchant activation
- **Requirements:** 4.4 (activation verification), 5.2 (connector setup)

## Overview

Activation requires typed `MerchantOwnershipVerification` records rather than possession of working credentials alone. Each record identifies target type/ID, merchant/legal subject, method, verifier actor, source evidence digest/reference, observed/expiry time, result, and revalidation rule.

Wrong-domain, wrong-shop, wrong-account, expired, revoked, or mismatched-subject evidence is Blocking.

## Verification Record Schema

Every verification method produces a record conforming to this typed structure:

```typescript
interface MerchantOwnershipVerification {
  /** Type of resource being verified */
  target_type: 'merchant_admin' | 'domain' | 'shopify_shop' | 'razorpay_account';

  /** Identifier of the target resource */
  target_id: string;

  /** Merchant legal/organizational subject */
  subject: string;

  /** Name of the verification method applied */
  method_name:
    | 'merchant_administrator_authority'
    | 'domain_control_or_dev_store_limitation'
    | 'shopify_shop_identity'
    | 'razorpay_test_account_ownership';

  /** Actor or system that performed verification */
  verifier_actor: string;

  /** Digest or URI of the source evidence */
  evidence_reference: string;

  /** Time the verification was observed/performed (ISO 8601) */
  observed_time: string;

  /** Time after which the verification expires (ISO 8601) */
  expiry_time: string;

  /** Outcome of the verification */
  result_type: 'VERIFIED' | 'BLOCKED' | 'EXPIRED' | 'PENDING_REVIEW';

  /** Rule governing automatic revalidation */
  revalidation_rule: string;

  /** Fallback when automated verification is insufficient */
  manual_review_fallback: string;
}
```

## Method 1: Merchant Administrator Authority

**Purpose:** Confirm that the requesting principal is an authorized merchant administrator with appropriate privileges.

| Field | Value |
|-------|-------|
| `target_type` | `merchant_admin` |
| `target_id` | Merchant tenant ID |
| `subject` | Authenticated principal identity |
| `method_name` | `merchant_administrator_authority` |
| `verifier_actor` | `counter_platform_auth_service` |
| `evidence_reference` | SHA-256 digest of auth session + MFA completion token |
| `observed_time` | Time of stepped-up authentication |
| `expiry_time` | Session expiry or 24 hours (whichever is shorter) |
| `result_type` | `VERIFIED` if allowlisted principal + MFA; `BLOCKED` otherwise |
| `revalidation_rule` | Re-verify on each activation attempt; step-up required for policy widening |
| `manual_review_fallback` | Operations team review of principal identity against merchant enrollment record |

### Verification Process

1. Principal authenticates through standard login flow.
2. System confirms principal is on pilot allowlist for the target merchant.
3. Step-up authentication (MFA) is required.
4. Session is elevated with activation-scoped authority.
5. Evidence record is created with session digest.

### Blocking Conditions

- Principal not on allowlist.
- MFA not completed.
- Session expired.
- Principal/merchant mismatch.

## Method 2: Domain Control or Development Store Limitation

**Purpose:** Confirm that the merchant controls the domain associated with their commerce presence, or document the development store limitation with operator review.

| Field | Value |
|-------|-------|
| `target_type` | `domain` |
| `target_id` | Merchant domain or Shopify development store identifier |
| `subject` | Merchant legal entity |
| `method_name` | `domain_control_or_dev_store_limitation` |
| `verifier_actor` | `counter_domain_verifier` or `counter_operator` (manual review) |
| `evidence_reference` | SHA-256 digest of DNS/HTTP challenge response or operator review record |
| `observed_time` | Time challenge was validated or review completed |
| `expiry_time` | 90 days from observation |
| `result_type` | `VERIFIED` if challenge passes; `PENDING_REVIEW` for operator review path |
| `revalidation_rule` | Re-verify before expiry; DNS changes trigger early revalidation |
| `manual_review_fallback` | Operator reviews shop identity binding against authenticated Shopify shop metadata |

### Verification Process (DNS/HTTP Challenge)

1. System generates unique challenge token.
2. Merchant places token at specified DNS TXT record or HTTP well-known path.
3. System queries and validates challenge response.
4. Evidence record created with challenge response digest.

### Verification Process (Development Store Limitation)

1. Shopify development store has no custom domain by default.
2. Operator reviews shop identity binding against authenticated Shopify OAuth shop metadata.
3. Accepted Limitation is documented: domain verification deferred until custom domain is configured.
4. Evidence record created with operator review digest and limitation acknowledgment.

### Blocking Conditions

- Challenge response mismatch.
- Domain resolves to unexpected target.
- Operator review identifies shop identity mismatch.
- Evidence expired without revalidation.

## Method 3: Shopify Shop Identity

**Purpose:** Confirm that the merchant owns/controls the Shopify store used for the connector, verified through the provider-authenticated OAuth install flow.

| Field | Value |
|-------|-------|
| `target_type` | `shopify_shop` |
| `target_id` | Shopify shop domain (e.g., `your-store.myshopify.com`) |
| `subject` | Merchant tenant ID bound to shop |
| `method_name` | `shopify_shop_identity` |
| `verifier_actor` | `counter_shopify_connector` |
| `evidence_reference` | SHA-256 digest of OAuth install callback payload (shop, scope, timestamp) |
| `observed_time` | Time of successful OAuth install/token exchange |
| `expiry_time` | Until app is uninstalled or scopes change (event-driven expiry) |
| `result_type` | `VERIFIED` if OAuth completes with expected shop + approved scopes |
| `revalidation_rule` | Re-verify on scope change, app reinstall, or periodic (90-day) check |
| `manual_review_fallback` | Operations review of Shopify partner dashboard evidence matching merchant tenant |

### Verification Process

1. Merchant initiates app install through Shopify admin.
2. Shopify authenticates the shop owner and presents scope consent.
3. OAuth callback delivers shop identity, approved scopes, and access token.
4. Connector verifies:
   - Shop domain matches expected `SHOPIFY_STORE_DOMAIN`.
   - Approved scopes include all required scopes (`read_products`, `write_draft_orders`, `read_orders`, `write_orders`, `read_inventory`).
   - Token is valid (test API call succeeds).
5. Evidence record created with OAuth payload digest (token value excluded).

### Blocking Conditions

- Shop domain mismatch with configured `SHOPIFY_STORE_DOMAIN`.
- Missing required scopes.
- OAuth flow did not complete.
- Token validation failure.
- Shop/merchant subject mismatch.

## Method 4: Razorpay Test Account Ownership

**Purpose:** Confirm that the merchant controls the Razorpay test account used for payment processing.

| Field | Value |
|-------|-------|
| `target_type` | `razorpay_account` |
| `target_id` | Razorpay account ID (masked) |
| `subject` | Merchant legal entity |
| `method_name` | `razorpay_test_account_ownership` |
| `verifier_actor` | `counter_operator` (formal review) |
| `evidence_reference` | SHA-256 digest of dashboard evidence + reviewer attestation |
| `observed_time` | Time of formal review completion |
| `expiry_time` | 90 days from review |
| `result_type` | `VERIFIED` if formal review confirms ownership; `PENDING_REVIEW` otherwise |
| `revalidation_rule` | Re-verify before expiry or on account change notification |
| `manual_review_fallback` | Required path (this is the primary method due to API limitations) |

### Verification Process

Razorpay test mode API does not expose sufficient account identity metadata to establish legal ownership programmatically. Therefore:

1. Merchant provides dashboard evidence (account settings screenshot with identifying details, business name confirmation) from the authenticated Razorpay dashboard.
2. Operator performs formal review:
   - Confirms business name matches merchant legal entity.
   - Confirms test mode key prefix (`rzp_test_`) matches configured `RAZORPAY_KEY_ID` prefix.
   - Validates that test API call with configured credentials succeeds.
   - Records reviewer identity, review time, and evidence digest.
3. Accepted Limitation is documented: full programmatic ownership verification is not available in test mode.
4. Evidence record created without storing dashboard screenshots containing secrets.

### Blocking Conditions

- Business name mismatch with merchant legal entity.
- Key ID does not have `rzp_test_` prefix (would indicate live keys).
- Test API call fails with configured credentials.
- Reviewer cannot confirm account ownership.
- Evidence expired without revalidation.

## Activation Integration

All four verification methods must produce `VERIFIED` results before activation can proceed. The activation snapshot pins:

- All verification record digests.
- Observed and expiry times.
- Any Accepted Limitations (e.g., domain verification deferred, Razorpay manual review).

### Expiry and Revalidation

- An `Expiring` readiness check is created when any verification approaches its `expiry_time`.
- Automatic revalidation is triggered before expiry for methods that support it.
- Expired verification without revalidation produces a `BLOCKED` result.
- Successful revalidation updates the activation snapshot with new evidence and times.

## Security Considerations

- Ownership records and their digests are pinned into the activation snapshot.
- Dashboard screenshots containing secrets are NOT stored.
- Credential validity alone is NEVER sufficient for ownership verification.
- Evidence references use content digests, not raw evidence payloads.
- Verification actors are identified and auditable.
- All verification attempts (successful and failed) are audit-logged.

## References

- [Requirements 4.4](../../.kiro/specs/counter-merchant-agent/requirements.md) - Activation verification
- [Requirements 5.2](../../.kiro/specs/counter-merchant-agent/requirements.md) - Connector setup
- [Design: Merchant ownership verification](../../.kiro/specs/counter-merchant-agent/design.md)
