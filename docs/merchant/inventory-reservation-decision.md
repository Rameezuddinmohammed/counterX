# Inventory Reservation: Pilot Constraint

- **Status:** Accepted
- **Date:** 2025-02-25
- **Scope:** Quote-time inventory availability semantics
- **Gate:** A (Integration Readiness)
- **Requirements:** 6.9 (freshness/stale data policy)

## Decision

The pilot does **not** implement inventory reservation between quote creation and order fulfillment. Inventory availability is checked as a point-in-time snapshot at quote creation only.

## Context

A full reservation system would require:

1. A distributed lock or counter for each variant's available quantity.
2. Automatic release of reserved inventory when a quote expires (15 minutes).
3. Coordination between multiple concurrent quote requests.
4. Integration with Shopify's inventory management to actually decrement quantities on reservation.

For the pilot, the complexity and failure modes of such a system outweigh the risk of overselling on a limited catalog with low concurrency.

## Behavior

### At Quote Creation

The `QuoteService` checks `inventorySnapshot.availableQuantity >= requestedQuantity` using the latest snapshot. If sufficient inventory exists, the quote is created successfully.

No inventory is reserved or decremented at this point.

### Concurrent Quotes

Two concurrent `createQuote` calls for the same variant can both succeed even if their combined quantity exceeds available stock. Each call independently checks the same snapshot.

Example:
- Available: 5 units
- Quote A requests 3 units -> succeeds (5 >= 3)
- Quote B requests 3 units -> succeeds (5 >= 3)
- Combined: 6 units requested, only 5 available

### Material Change Detection

The `detectMaterialChange` function partially mitigates this gap by re-checking inventory at order time. If inventory has dropped below the quoted quantity (due to another order being placed), the material change is detected and the quote is flagged as invalid.

This is a post-hoc mitigation, not a prevention mechanism.

## Accepted Limitations

| Limitation | Impact | Mitigation |
|---|---|---|
| No reservation at quote time | Potential overselling under concurrency | Material change detection at order time |
| Snapshot-based check only | Stale data between sync and quote | Freshness policy rejects stale snapshots |
| No Shopify inventory decrement | Inventory not held in source system | Low pilot volume makes this acceptable |

## Why This Is Intentional

1. **Pilot scope:** The pilot operates with a small catalog and low order volume where concurrent overselling is unlikely.
2. **Complexity avoidance:** Distributed reservation adds significant failure modes (leaked reservations, network partitions, timeout handling).
3. **Shopify limitations:** Shopify does not natively expose a "reserve inventory" API for draft orders without creating an actual order.
4. **Material change safety net:** The CTP digest and material change detection provide a downstream guard before order finalization.

## Future Evolution

When the pilot constraints are lifted:

1. **Soft reservation:** Implement an in-process reservation counter that decrements available quantity for the duration of quote validity (15 minutes).
2. **Distributed reservation:** Use a shared reservation store (Redis or database) for multi-instance deployments.
3. **Shopify draft order:** Create a Shopify draft order at quote time to leverage Shopify's native inventory hold.
4. **Reservation release:** Automatic cleanup of expired reservations via TTL or scheduled sweep.

Each evolution requires a new Gate decision and testing under concurrent load.

## References

- [Tax/Shipping Decision](./tax-shipping-decision.md) - Related pilot constraint decision
- [Gate A Decisions](./gate-a-decisions.md) - Full list of pilot constraints
- QuoteService: `packages/shopify-connector/src/quote-service.ts`
- Material change detection: `packages/shopify-connector/src/quote-verification.ts`
