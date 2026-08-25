# Shopify Connector Adapter Manifest

- **Status:** Accepted
- **Date:** 2025-02-20
- **Connector:** `shopify-connector`
- **Provider:** Shopify
- **App Type:** Custom app for development store
- **API Version:** 2025-07
- **Requirements:** 5 (connector contract), 4 (activation verification)

## Overview

This manifest declares the capabilities, constraints, and operational parameters of the Shopify connector for the Counter Merchant pilot. The connector interfaces with the Shopify Admin GraphQL API for commerce data synchronization and order lifecycle management.

## Authentication

| Property | Value |
|----------|-------|
| Method | Custom app install with offline access token |
| Token type | Offline access token (does not expire unless app is uninstalled) |
| Credential storage | Foundation secret-reference boundary (environment variable) |
| Store domain | Via `SHOPIFY_STORE_DOMAIN` environment variable |
| Webhook verification | HMAC-SHA256 using `SHOPIFY_WEBHOOK_SECRET` |

**Environment variables:**
- `SHOPIFY_STORE_DOMAIN` - Store domain (e.g., `your-store.myshopify.com`)
- `SHOPIFY_API_VERSION` - Pinned API version (`2025-07`)
- `SHOPIFY_CLIENT_ID` - App client ID
- `SHOPIFY_CLIENT_SECRET` - App client secret
- `SHOPIFY_ACCESS_TOKEN` - Offline access token
- `SHOPIFY_WEBHOOK_SECRET` - Webhook signing secret

No real credential values (shpat_*, shpss_*) are stored in source control.

## Network

| Property | Value |
|----------|-------|
| GraphQL endpoint | `https://{shop}/admin/api/2025-07/graphql.json` |
| Protocol | HTTPS (TLS 1.2+) |
| Egress | Allowlisted to `*.myshopify.com` |
| SSRF protection | Domain validation, no private IP/metadata endpoints |

## API Version Policy

| Property | Value |
|----------|-------|
| Pinned version | 2025-07 |
| Deprecation date | April 1, 2026 (earliest) |
| Access end | July 16, 2026 |
| Upgrade trigger | New Gate A decision required |

**Source:** [Shopify API Versioning](https://shopify.dev/docs/api/usage/versioning)

## OAuth Scopes (Least Privilege)

| Scope | Purpose |
|-------|---------|
| `read_products` | Product/variant/inventory catalog sync |
| `write_draft_orders` | Create and complete draft orders |
| `read_orders` | Query order/payment/fulfillment status |
| `write_orders` | Mark as paid, cancel orders |
| `read_inventory` | Inventory availability for quote |

Scope expansion forces connector readiness review and manifest re-signing.

## Rate Limiting

| Property | Value |
|----------|-------|
| Model | GraphQL cost-based throttling |
| Bucket size | 1000 points |
| Restore rate | 50 points/second (Plus/development stores) |
| Monitoring | `throttleStatus` in GraphQL response extensions |
| Strategy | Adaptive backoff with cost pre-calculation |

**Source:** [Shopify Rate Limits](https://shopify.dev/docs/api/usage/rate-limits)

## Resources and Actions

### Read Operations

| Resource | Method | Freshness |
|----------|--------|-----------|
| Shop metadata | GraphQL query | On-demand |
| Products/variants | Backfill + webhook + reconciliation poll | Configurable budget |
| Inventory levels | GraphQL query | Per-quote refresh within budget |
| Orders | GraphQL query | On-demand for reconciliation |
| Draft orders | GraphQL query | On-demand |

### Write Operations (Typed Actions)

| Action | Mutation | Scope Required | Idempotency |
|--------|----------|---------------|-------------|
| `create_draft_order` | `draftOrderCreate` | `write_draft_orders` | Counter workflow uniqueness + correlation metadata |
| `complete_draft_order` | `draftOrderComplete(paymentPending: true)` | `write_draft_orders` | Draft ID + state check |
| `mark_order_paid` | `orderMarkAsPaid` | `write_orders` | Order ID + financial status check |
| `cancel_order` | `orderCancel` | `write_orders` | Order ID + cancellation state check |
| `create_refund` | `refundCreate` | `write_orders` | Order ID + refund existence check |

### Draft Order Test Sequence

```text
draftOrderCreate
  -> query draft order (confirm state)
  -> draftOrderComplete(paymentPending: true)
  -> orderMarkAsPaid
  -> query order (confirm final state)
  -> orderCancel (where eligible)
  -> refundCreate (where eligible)
```

**Constraints:**
- Inventory is NOT reserved by default on draft orders.
- Mutations that lack native idempotency use Counter workflow uniqueness plus search/query by Counter correlation metadata.
- Possible but unknown write outcomes become Indeterminate and are not blindly retried.

## Webhook Topics

| Topic | Purpose |
|-------|---------|
| `products/update` | Incremental catalog sync |
| `products/delete` | Tombstone/unpublish handling |
| `orders/create` | Order lifecycle observation |
| `orders/updated` | Status/fulfillment changes |
| `orders/cancelled` | Cancellation evidence |
| `refunds/create` | Refund reconciliation |

### Webhook Processing

- Signature verification: HMAC-SHA256 using webhook secret on raw request body.
- Durable inbox with deduplication by source/topic/event ID.
- No mutation of canonical state before signature and inbox acceptance.
- Dead-letter with merchant-safe diagnostics for unprocessable events.

## Sandbox Behavior

| Property | Value |
|----------|-------|
| Environment | Shopify development store |
| Data | Test/synthetic catalog only |
| Payments | Test payment gateway or external test provider |
| Inventory | Development store test inventory |
| Isolation | Sandbox identities do not authorize production effects |

## Data Classification

| Data Type | Classification | Handling |
|-----------|---------------|----------|
| Access token | Secret | Environment variable only, never logged |
| Webhook secret | Secret | Environment variable only, never logged |
| Product data | Internal | Commerce Graph with provenance |
| Order data | Confidential | Encrypted at rest, audit-logged access |
| Customer references | PII | Minimal collection, purpose-limited |

## Compensation and Error Handling

- Failed draft order creation: No side effects, safe to retry with new idempotency key.
- Failed draft order completion: Query draft state, retry if still in OPEN state.
- Failed mark-as-paid: Query order financial status, reconcile with payment evidence.
- Indeterminate outcomes: Flagged for reconciliation, not retried blindly.
- Timeout-before-effect: Safe to retry with correlation check.
- Timeout-after-effect: Query for existing effect before retry.

## References

- [Shopify Admin GraphQL API 2025-07](https://shopify.dev/docs/api/admin-graphql/2025-07)
- [Shopify draftOrderCreate](https://shopify.dev/docs/api/admin-graphql/2025-07/mutations/draftOrderCreate)
- [Shopify draftOrderComplete](https://shopify.dev/docs/api/admin-graphql/2025-07/mutations/draftOrderComplete)
- [Shopify orderMarkAsPaid](https://shopify.dev/docs/api/admin-graphql/2025-07/mutations/orderMarkAsPaid)
- [Shopify Webhooks](https://shopify.dev/docs/api/admin-graphql/2025-07/enums/WebhookSubscriptionTopic)
- [Shopify Rate Limits](https://shopify.dev/docs/api/usage/rate-limits)
- [Shopify API Versioning](https://shopify.dev/docs/api/usage/versioning)
