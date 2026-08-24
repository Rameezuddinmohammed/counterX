# Gate A Decisions: Merchant Integration

- **Status:** Accepted
- **Date:** 2025-02-20
- **Gate:** A (Integration Readiness)
- **Scope:** Shopify connector, Razorpay test adapter, tax/shipping pilot, verification methods
- **Requirements:** 4, 5, 11 (counter-merchant-agent requirements.md)

## Purpose

Gate A confirms that external integration decisions are proven against real provider environments before implementation begins. Each decision is backed by development-store or test-mode evidence rather than documentation alone.

## Decisions Summary

| # | Decision | Reference |
|---|----------|-----------|
| 1 | Pin Shopify Admin API to version **2025-07** | [shopify-adapter-manifest.md](./shopify-adapter-manifest.md) |
| 2 | Use GraphQL cost-based throttling with 1000-point bucket | [shopify-adapter-manifest.md](./shopify-adapter-manifest.md) |
| 3 | Razorpay Standard Checkout in test mode with manual capture | [razorpay-adapter-manifest.md](./razorpay-adapter-manifest.md) |
| 4 | Tax/shipping uses merchant-approved fixed configuration | [tax-shipping-decision.md](./tax-shipping-decision.md) |
| 5 | Four typed verification methods for activation | [verification-methods.md](./verification-methods.md) |
| 6 | Draft order flow for Shopify order creation | [shopify-adapter-manifest.md](./shopify-adapter-manifest.md) |
| 7 | INR only, paise integer amounts for Razorpay | [razorpay-adapter-manifest.md](./razorpay-adapter-manifest.md) |

## Decision 1: Shopify Admin API Version

**Choice:** Pin to `2025-07` (latest stable).

**Rationale:**
- Accessible until July 16, 2026 per Shopify quarterly versioning policy.
- Provides stable `draftOrderCreate`, `draftOrderComplete`, `orderMarkAsPaid`, and `orderCancel` mutations.
- GraphQL endpoint pattern: `https://{shop}/admin/api/2025-07/graphql.json`

**Evidence:** Development store connectivity confirmed via environment variable `SHOPIFY_STORE_DOMAIN`.

**Source:** [Shopify API Versioning](https://shopify.dev/docs/api/usage/versioning)

## Decision 2: GraphQL Cost-Based Throttling

**Choice:** Implement cost-aware request scheduling against a 1000-point bucket with 50 points/sec restore rate.

**Rationale:**
- Development and Plus stores share this bucket configuration.
- Each query/mutation returns `throttleStatus` in extensions, enabling adaptive backoff.
- Bulk operations use a separate allocation and are not used in pilot.

**Source:** [Shopify Rate Limits](https://shopify.dev/docs/api/usage/rate-limits)

## Decision 3: Razorpay Standard Checkout (Test Mode)

**Choice:** Use Razorpay Standard Checkout with manual capture in test mode.

**Rationale:**
- Standard Checkout requires human interaction (browser-hosted payment UI).
- Manual capture allows verification before funds settlement.
- Test mode (key prefix `rzp_test_`) provides deterministic test instruments.
- Counter does not automate OTP, PIN, or bank approval.

**Source:** [Razorpay Standard Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/)

## Decision 4: Tax and Shipping Pilot Configuration

**Choice:** Use merchant-approved fixed-rate configuration rather than dynamic Shopify tax/shipping calculation.

**Rationale:**
- Shopify tax calculation requires additional app permissions and jurisdiction setup not available on all development stores.
- Fixed rates are deterministic, auditable, and independently verifiable.
- The quote source field is set to `merchant_pilot_config` for traceability.

**Limitations explicitly NOT supported:**
- Automatic tax calculation
- Dynamic shipping rates
- Tax exemptions
- Multi-rate tax jurisdictions

See [tax-shipping-decision.md](./tax-shipping-decision.md) for full details.

## Decision 5: Typed Verification Methods

**Choice:** Four typed `MerchantOwnershipVerification` methods for activation readiness.

1. Merchant Administrator Authority
2. Domain Control or Development Store Limitation
3. Shopify Shop Identity
4. Razorpay Test Account Ownership

Each method produces a typed record with target, subject, verifier, evidence, time bounds, and revalidation rules. See [verification-methods.md](./verification-methods.md).

## Decision 6: Draft Order Flow

**Choice:** Use the Shopify draft order lifecycle for pilot order creation.

**Sequence:**
1. `draftOrderCreate` - create draft with line items and customer
2. Query draft order - confirm state
3. `draftOrderComplete(paymentPending: true)` - convert to order
4. `orderMarkAsPaid` - record payment after provider confirmation
5. Query order - confirm final state
6. `orderCancel` / `refundCreate` - post-purchase actions where eligible

**Constraints:**
- `write_draft_orders` scope required for create/complete
- `write_orders` scope required for mark-as-paid and cancel
- Inventory is NOT reserved by default on draft orders

## Decision 7: Razorpay Currency and Amount

**Choice:** INR only, amounts expressed in paise (integer minor units).

**Rationale:**
- Razorpay test mode supports INR.
- Integer paise avoids floating-point rounding in financial calculations.
- Aligns with foundation requirement for integer minor units with ISO currency.

## Consequences

- All connector implementations pin to these versions and patterns.
- Version upgrades require a new Gate decision and readiness revalidation.
- Tax/shipping limitations are surfaced as Accepted Limitations in the Capability Manifest.
- Verification method expiry triggers automatic revalidation before activation renewal.

## Related Documents

- [Shopify Adapter Manifest](./shopify-adapter-manifest.md)
- [Razorpay Adapter Manifest](./razorpay-adapter-manifest.md)
- [Tax/Shipping Decision](./tax-shipping-decision.md)
- [Verification Methods](./verification-methods.md)
- [Requirements 4-5, 11](../../.kiro/specs/counter-merchant-agent/requirements.md)
- [Design: Gate A decisions](../../.kiro/specs/counter-merchant-agent/design.md)
