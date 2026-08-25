/**
 * GraphQL mutation strings for Shopify order operations.
 *
 * Each mutation propagates Counter correlation metadata via note
 * attributes and metafields so that external observers can trace
 * mutations back to the originating Counter workflow.
 */

// ─── Draft Order Create ───────────────────────────────────────────────────────

export const DRAFT_ORDER_CREATE_MUTATION = `
mutation draftOrderCreate($input: DraftOrderInput!) {
  draftOrderCreate(input: $input) {
    draftOrder {
      id
      name
      status
      totalPrice
      currencyCode
      createdAt
    }
    userErrors {
      field
      message
    }
  }
}
` as const;

// ─── Draft Order Complete (Finalize) ──────────────────────────────────────────

export const DRAFT_ORDER_COMPLETE_MUTATION = `
mutation draftOrderComplete($id: ID!, $paymentPending: Boolean!) {
  draftOrderComplete(id: $id, paymentPending: $paymentPending) {
    draftOrder {
      order {
        id
        name
        displayFinancialStatus
        totalPriceSet {
          shopMoney {
            amount
            currencyCode
          }
        }
        createdAt
      }
    }
    userErrors {
      field
      message
    }
  }
}
` as const;

// ─── Order Mark As Paid ───────────────────────────────────────────────────────

export const ORDER_MARK_AS_PAID_MUTATION = `
mutation orderMarkAsPaid($input: OrderMarkAsPaidInput!) {
  orderMarkAsPaid(input: $input) {
    order {
      id
      displayFinancialStatus
      processedAt
    }
    userErrors {
      field
      message
    }
  }
}
` as const;

// ─── Order Cancel ─────────────────────────────────────────────────────────────

export const ORDER_CANCEL_MUTATION = `
mutation orderCancel($orderId: ID!, $reason: OrderCancelReason!, $notifyCustomer: Boolean!, $refund: Boolean!, $staffNote: String) {
  orderCancel(orderId: $orderId, reason: $reason, notifyCustomer: $notifyCustomer, refund: $refund, staffNote: $staffNote) {
    orderCancelUserErrors {
      field
      message
      code
    }
  }
}
` as const;

// ─── Refund Create ────────────────────────────────────────────────────────────

export const REFUND_CREATE_MUTATION = `
mutation refundCreate($input: RefundInput!) {
  refundCreate(input: $input) {
    refund {
      id
      createdAt
      order {
        id
      }
    }
    userErrors {
      field
      message
    }
  }
}
` as const;

// ─── Draft Order Query ────────────────────────────────────────────────────────

export const DRAFT_ORDER_QUERY = `
query draftOrder($id: ID!) {
  draftOrder(id: $id) {
    id
    name
    status
    totalPrice
    currencyCode
    createdAt
    noteAttributes {
      name
      value
    }
  }
}
` as const;

// ─── Order Query ──────────────────────────────────────────────────────────────

export const ORDER_QUERY = `
query order($id: ID!) {
  order(id: $id) {
    id
    name
    displayFinancialStatus
    cancelledAt
    totalPriceSet {
      shopMoney {
        amount
        currencyCode
      }
    }
    createdAt
    noteAttributes {
      name
      value
    }
  }
}
` as const;

// ─── Helper: Build Note Attributes ───────────────────────────────────────────

export function buildNoteAttributes(
  correlationId: string,
  idempotencyKey: string,
): readonly { readonly name: string; readonly value: string }[] {
  return Object.freeze([
    Object.freeze({ name: "counter_correlation_id", value: correlationId }),
    Object.freeze({ name: "counter_idempotency_key", value: idempotencyKey }),
  ]);
}
