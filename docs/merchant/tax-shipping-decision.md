# Tax and Shipping Pilot Decision

- **Status:** Accepted
- **Date:** 2025-02-20
- **Scope:** Pilot tax and shipping calculation approach
- **Gate:** A (Integration Readiness)
- **Requirements:** 6.9 (freshness/stale data policy), 7.1 (merchant configuration)

## Decision

The pilot uses merchant-approved fixed configuration for tax and shipping calculation rather than dynamic Shopify tax/shipping APIs.

## Context

Shopify provides automatic tax calculation and carrier-calculated shipping rates. However, these features:

1. Require additional app permissions and jurisdiction configuration not universally available on development stores.
2. Introduce non-deterministic external dependencies in the quote pipeline.
3. Complicate independent verification of quote arithmetic.
4. May vary by Shopify plan, region, and carrier integration status.

For the pilot, deterministic and independently verifiable behavior takes priority over dynamic provider features.

## Configuration Model

### Fixed Shipping Rate

| Property | Value |
|----------|-------|
| Type | Flat rate per order |
| Source | Merchant pilot configuration |
| Configured by | Merchant administrator during activation |
| Unit | Integer paise (INR) |
| Scope | India destination only |
| Source field | `merchant_pilot_config` |

Example: A merchant configures a flat shipping rate of 5000 paise (50 INR) for all pilot orders.

### Fixed Tax Rate

| Property | Value |
|----------|-------|
| Type | Percentage (GST) applied to line item subtotal |
| Source | Merchant pilot configuration |
| Configured by | Merchant administrator during activation |
| Precision | Basis points (e.g., 1800 = 18.00%) |
| Scope | Single rate applied uniformly |
| Source field | `merchant_pilot_config` |

Example: A merchant configures GST at 1800 basis points (18%) applied to the pre-shipping subtotal.

## Quote Calculation

```text
line_item_subtotal = sum(variant_price * quantity) for each line item
tax_amount = floor(line_item_subtotal * tax_rate_bps / 10000)
shipping_amount = configured_flat_rate
total = line_item_subtotal + tax_amount + shipping_amount
```

All amounts are integer paise. Rounding uses floor to avoid overcharging.

### Quote Metadata

Every quote produced under this decision includes:

| Field | Value |
|-------|-------|
| `tax_source` | `merchant_pilot_config` |
| `shipping_source` | `merchant_pilot_config` |
| `tax_rate_bps` | Configured rate in basis points |
| `shipping_flat_paise` | Configured flat rate in paise |
| `calculation_method` | `fixed_pilot_v1` |

This metadata enables:
- Independent verification of quote arithmetic.
- Clear provenance for audit.
- Explicit identification that dynamic calculation was not used.

## Explicitly NOT Supported

The following are NOT available in the pilot and are marked as limitations in the Capability Manifest:

| Feature | Status | Rationale |
|---------|--------|-----------|
| Automatic tax calculation | NOT SUPPORTED | Requires Shopify Tax API + jurisdiction setup |
| Dynamic shipping rates | NOT SUPPORTED | Requires carrier integrations + real-time API calls |
| Tax exemptions | NOT SUPPORTED | Requires customer tax-exempt status management |
| Multi-rate tax (different rates per category) | NOT SUPPORTED | Requires product-level tax classification |
| Tax-inclusive pricing | NOT SUPPORTED | Requires Shopify market configuration |
| Free shipping thresholds | NOT SUPPORTED | Requires rule engine beyond pilot scope |
| Weight-based shipping | NOT SUPPORTED | Requires variant weight data + rate tables |
| Location-based tax | NOT SUPPORTED | Requires address-level jurisdiction lookup |

## Accepted Limitations

These are surfaced as `Accepted Limitation` findings in the activation readiness assessment:

1. **Single tax rate:** All products taxed at the same rate regardless of category or HSN code.
2. **Flat shipping:** No variation by weight, distance, speed, or order value.
3. **No dynamic refresh:** Rates are static until merchant reconfigures and re-activates.
4. **India only:** Only INR amounts and India destinations are supported.

Each limitation requires:
- Merchant acknowledgment before activation.
- Clear indication in the Capability Manifest.
- Documentation in the quote envelope for downstream consumers.

## Future Evolution

When the pilot constraints are lifted:

1. **Dynamic tax:** Integrate Shopify Tax API or third-party tax service with deterministic caching and freshness budgets.
2. **Carrier shipping:** Integrate Shopify carrier-calculated rates with timeout/fallback to configured defaults.
3. **Multi-rate tax:** Product-level HSN classification with rate lookup tables.
4. **Tax exemptions:** Customer tax-exempt status with evidence.

Each evolution requires a new Gate decision, readiness validation, and Capability Manifest re-signing.

## Consequences

- Quote arithmetic is fully deterministic and independently verifiable.
- Tax/shipping limitations are explicit in the Capability Manifest.
- Merchants must acknowledge limitations during activation.
- No external tax/shipping API calls during quote generation (eliminates a failure mode).
- Future dynamic tax/shipping requires a new Gate decision.

## References

- [Requirements 6.9](../../.kiro/specs/counter-merchant-agent/requirements.md) - Freshness and stale data policy
- [Requirements 7.1](../../.kiro/specs/counter-merchant-agent/requirements.md) - Merchant configuration
- [Design: Quote service](../../.kiro/specs/counter-merchant-agent/design.md)
- [Shopify Tax API](https://shopify.dev/docs/api/admin-graphql/2025-07/objects/TaxLine)
