# Razorpay Test Adapter Manifest

- **Status:** Accepted
- **Date:** 2025-02-20
- **Adapter:** `razorpay-test-adapter`
- **Provider:** Razorpay
- **Environment:** Test mode
- **API Version:** v1
- **Checkout Profile:** Standard Checkout
- **Requirements:** 11 (non-custodial payment), 4 (activation verification)

## Overview

This manifest declares the capabilities, constraints, and operational parameters of the Razorpay test payment adapter for the Counter Merchant pilot. The adapter implements the `PaymentProvider` interface using Razorpay Standard Checkout in test mode with manual capture.

Counter is non-custodial: funds move through the regulated Razorpay path to the merchant's Razorpay account. Counter does not hold, pool, receive, transmit, settle, or credit funds.

## Authentication

| Property | Value |
|----------|-------|
| Method | Basic Auth (Key ID + Key Secret) |
| Key prefix | `rzp_test_` (test mode identifier) |
| Credential storage | Foundation secret-reference boundary (environment variable) |
| Webhook verification | HMAC-SHA256 using webhook secret on raw request body |

**Environment variables:**
- `RAZORPAY_KEY_ID` - Test key ID (prefix `rzp_test_`)
- `RAZORPAY_KEY_SECRET` - Test key secret
- `RAZORPAY_WEBHOOK_SECRET` - Webhook signing secret

No real credential values are stored in source control.

## Network

| Property | Value |
|----------|-------|
| Base URL | `https://api.razorpay.com/v1` |
| Protocol | HTTPS (TLS 1.2+) |
| Egress | Allowlisted to `api.razorpay.com`, `checkout.razorpay.com` |
| SSRF protection | Domain validation, no private IP/metadata endpoints |

## Checkout Flow

### Standard Checkout Lifecycle

```text
1. Create Order (server-side)
   POST /orders
   { amount, currency, receipt, notes }

2. Open Checkout (browser, human action)
   Razorpay hosted payment UI
   User selects method and completes payment action

3. Verify Payment (server-side)
   Validate razorpay_signature
   Query payment status via API

4. Capture Payment (server-side, manual capture)
   POST /payments/{payment_id}/capture
   { amount, currency }
```

### Critical Constraint

Razorpay Standard Checkout requires a direct human action to open the payment UI. The browser callback alone is NOT payment truth. Server verification, capture state, webhooks, and provider queries are required.

Counter SHALL NOT:
- Automate OTP, PIN, or bank approval
- Describe Standard Checkout as unattended delegated payment
- Treat browser callback as authoritative payment confirmation

The checkout step returns `PAYMENT_ACTION_REQUIRED` to the calling agent/client.

## API Operations

### Order Creation

```text
POST /orders
Content-Type: application/json
Authorization: Basic {key_id}:{key_secret}

{
  "amount": <integer_paise>,
  "currency": "INR",
  "receipt": "<counter_correlation_id>",
  "notes": {
    "counter_transaction_id": "<transaction_id>",
    "counter_merchant_id": "<merchant_id>"
  }
}
```

| Field | Constraint |
|-------|-----------|
| `amount` | Integer in paise (100 paise = 1 INR) |
| `currency` | `INR` only for pilot |
| `receipt` | Counter correlation ID for idempotency/reconciliation |
| `notes` | Counter metadata for traceability |

### Payment Capture (Manual)

```text
POST /payments/{payment_id}/capture
Content-Type: application/json
Authorization: Basic {key_id}:{key_secret}

{
  "amount": <integer_paise>,
  "currency": "INR"
}
```

Capture is called only after:
1. `payment.authorized` webhook received and verified, OR
2. Payment status query confirms `authorized` state.

### Payment Verification

Server-side signature verification:
```text
generated_signature = HMAC-SHA256(
  razorpay_order_id + "|" + razorpay_payment_id,
  key_secret
)
```

### Refund

```text
POST /payments/{payment_id}/refund
Content-Type: application/json
Authorization: Basic {key_id}:{key_secret}

{
  "amount": <integer_paise>
}
```

| Constraint | Value |
|-----------|-------|
| Refund type | Full refund only for pilot |
| Partial refund | NOT supported in pilot |
| Currency | INR only |

## Capture Mode

| Property | Value |
|----------|-------|
| Mode | Manual capture |
| Trigger | `payment.authorized` event or status query |
| Auto-capture | Disabled |
| Timeout | Payment expires if not captured within Razorpay window |

## Webhook Events

| Event | Purpose |
|-------|---------|
| `payment.authorized` | Trigger capture decision |
| `payment.captured` | Confirm capture success |
| `payment.failed` | Record payment failure |
| `refund.created` | Refund initiation evidence |
| `refund.processed` | Refund completion evidence |

### Webhook Processing

- Signature: HMAC-SHA256 using webhook secret on raw request body.
- Durable inbox with deduplication by event ID.
- Idempotent processing (redelivered events do not duplicate effects).
- Dead-letter with sanitized diagnostics for unprocessable events.

## Test Mode Behavior

| Property | Value |
|----------|-------|
| Key prefix | `rzp_test_` |
| Real money | No |
| Available methods | Test card, test UPI, test netbanking |
| Test card | `4111 1111 1111 1111` (any future expiry, any CVV) |
| Webhooks | Delivered for test transactions |
| Deterministic | Test instruments produce predictable outcomes |

### Test Mode Constraints

- Test keys are rejected in production environments.
- Test transactions do not process real money.
- Counter test provider (`CounterTestPaymentProvider`) is a separate path and does not establish Razorpay compatibility.

## Currency and Amount

| Property | Value |
|----------|-------|
| Currency | INR only |
| Unit | Paise (integer minor units) |
| Conversion | 1 INR = 100 paise |
| Minimum | Provider minimum (typically 100 paise = 1 INR) |

Aligns with foundation requirement: integer minor units with ISO currency code.

## Idempotency

| Operation | Strategy |
|-----------|----------|
| Order creation | `receipt` field as Counter correlation ID |
| Capture | Payment ID + capture status check |
| Refund | Payment ID + refund existence check |

Possible but unknown outcomes become Indeterminate and are not blindly retried.

## Data Classification

| Data Type | Classification | Handling |
|-----------|---------------|----------|
| Key ID/Secret | Secret | Environment variable only, never logged |
| Webhook secret | Secret | Environment variable only, never logged |
| Payment ID | Confidential | Audit-logged, encrypted at rest |
| Order ID | Internal | Counter correlation for reconciliation |
| Customer payment details | Prohibited | Never stored, provider-hosted only |

Counter does not store PAN, CVV, UPI PIN, bank credentials, or equivalent secrets.

## Compensation and Error Handling

- Failed order creation: No side effects, safe to retry.
- Authorized but not captured: Payment expires per Razorpay window; reconciliation checks.
- Failed capture: Query payment status, retry if still authorized.
- Indeterminate outcomes: Flagged for reconciliation, not retried blindly.
- Webhook delivery failure: Razorpay retries with exponential backoff.

## References

- [Razorpay Standard Checkout](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/)
- [Razorpay Orders API](https://razorpay.com/docs/api/orders/)
- [Razorpay Payments API](https://razorpay.com/docs/api/payments/)
- [Razorpay Refunds API](https://razorpay.com/docs/api/refunds/)
- [Razorpay Webhooks](https://razorpay.com/docs/webhooks/)
- [Razorpay Webhook Validation](https://razorpay.com/docs/webhooks/validate-test/)
- [Razorpay Test Mode](https://razorpay.com/docs/payments/payment-gateway/web-integration/standard/test-integration/)
