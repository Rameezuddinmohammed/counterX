import { describe, expect, it } from "vitest";
import {
  PACKAGE_NAME,
} from "./index.js";
import type {
  MerchantCapabilitySchema,
  MerchantSearchSchema,
  MerchantQuoteSchema,
  MerchantTransactionSchema,
  MerchantReceiptSchema,
  MerchantReceiptItem,
} from "./index.js";

describe("@counter/merchant-contracts", () => {
  it("exposes its package identity", () => {
    expect(PACKAGE_NAME).toBe("@counter/merchant-contracts");
  });

  it("MerchantCapabilitySchema type is structurally correct", () => {
    const schema: MerchantCapabilitySchema = {
      merchantId: "m-1",
      capabilities: ["search", "quote", "transaction"],
      connectorStatus: "connected",
    };
    expect(schema.connectorStatus).toBe("connected");
  });

  it("MerchantSearchSchema type is structurally correct", () => {
    const schema: MerchantSearchSchema = {
      query: "blue shirt",
      merchantId: "m-1",
      limit: 20,
      offset: 0,
      filters: { category: "apparel" },
    };
    expect(schema.query).toBe("blue shirt");
    expect(schema.limit).toBe(20);
  });

  it("MerchantQuoteSchema type is structurally correct", () => {
    const schema: MerchantQuoteSchema = {
      merchantId: "m-1",
      variantId: "var-1",
      quantity: 2,
      requestedAt: "2024-01-01T00:00:00Z",
    };
    expect(schema.quantity).toBe(2);
  });

  it("MerchantTransactionSchema type is structurally correct", () => {
    const schema: MerchantTransactionSchema = {
      transactionId: "txn-1",
      merchantId: "m-1",
      action: "create",
      amount: "99.99",
      currency: "USD",
    };
    expect(schema.action).toBe("create");
  });

  it("MerchantReceiptSchema type is structurally correct", () => {
    const schema: MerchantReceiptSchema = {
      receiptId: "rcpt-1",
      transactionId: "txn-1",
      merchantId: "m-1",
      issuedAt: "2024-01-01T00:00:00Z",
      items: [
        {
          variantId: "var-1",
          quantity: 1,
          unitPrice: "49.99",
          total: "49.99",
        },
      ],
    };
    expect(schema.items).toHaveLength(1);
  });

  it("MerchantReceiptItem type is structurally correct", () => {
    const item: MerchantReceiptItem = {
      variantId: "var-2",
      quantity: 3,
      unitPrice: "10.00",
      total: "30.00",
    };
    expect(item.quantity).toBe(3);
    expect(item.total).toBe("30.00");
  });
});
