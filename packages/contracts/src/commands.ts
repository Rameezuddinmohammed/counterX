/**
 * Immutable command schemas for the Counter transaction orchestration domain.
 *
 * Each command includes base fields (commandId, transactionId, issuedAt, authority)
 * plus command-specific fields. The union is discriminated on the "type" field.
 */

import type { CounterId, Instant, IsoCurrencyCode, Money, Sha256Digest } from "@counter/domain";
import type { AuthorityContext } from "./authority-context.js";

// ---------------------------------------------------------------------------
// Base command fields shared by all commands
// ---------------------------------------------------------------------------

interface CommandBase {
  readonly commandId: CounterId<"command">;
  readonly transactionId: CounterId<"transaction">;
  readonly issuedAt: Instant;
  readonly authority: AuthorityContext;
}

// ---------------------------------------------------------------------------
// Individual command types
// ---------------------------------------------------------------------------

export interface CreateTransaction extends CommandBase {
  readonly type: "CreateTransaction";
  readonly currency: IsoCurrencyCode;
  readonly description: string;
}

export interface SubmitQuote extends CommandBase {
  readonly type: "SubmitQuote";
  readonly quoteId: CounterId<"quote">;
  readonly sourceAmount: Money;
  readonly targetAmount: Money;
  readonly expiresAt: Instant;
}

export interface SubmitIntent extends CommandBase {
  readonly type: "SubmitIntent";
  readonly amount: Money;
  readonly paymentMethod: string;
  readonly metadata: Readonly<Record<string, string>>;
}

export interface ApproveIntent extends CommandBase {
  readonly type: "ApproveIntent";
  readonly approvedAmount: Money;
  readonly conditions: readonly string[];
}

export interface CreatePaymentInstruction extends CommandBase {
  readonly type: "CreatePaymentInstruction";
  readonly instructedAmount: Money;
  readonly paymentMethod: string;
  readonly paymentReference: CounterId<"payment-reference">;
}

export interface RecordPaymentResult extends CommandBase {
  readonly type: "RecordPaymentResult";
  readonly success: boolean;
  readonly settledAmount: Money;
  readonly providerReference: string;
}

export interface CreateOrder extends CommandBase {
  readonly type: "CreateOrder";
  readonly orderAmount: Money;
  readonly items: readonly OrderItem[];
}

export interface OrderItem {
  readonly sku: string;
  readonly quantity: number;
  readonly unitPrice: Money;
}

export interface RecordOrderResult extends CommandBase {
  readonly type: "RecordOrderResult";
  readonly success: boolean;
  readonly providerOrderId: string;
}

export interface RequestCancellation extends CommandBase {
  readonly type: "RequestCancellation";
  readonly reason: string;
}

export interface RequestRefund extends CommandBase {
  readonly type: "RequestRefund";
  readonly refundAmount: Money;
  readonly reason: string;
}

export interface RecordRefundResult extends CommandBase {
  readonly type: "RecordRefundResult";
  readonly success: boolean;
  readonly refundedAmount: Money;
  readonly providerReference: string;
}

export interface ResolveIndeterminate extends CommandBase {
  readonly type: "ResolveIndeterminate";
  readonly resolution: "succeeded" | "failed" | "requires_manual_review";
  readonly evidence: Sha256Digest;
}

// ---------------------------------------------------------------------------
// Discriminated union of all commands
// ---------------------------------------------------------------------------

export type Command =
  | CreateTransaction
  | SubmitQuote
  | SubmitIntent
  | ApproveIntent
  | CreatePaymentInstruction
  | RecordPaymentResult
  | CreateOrder
  | RecordOrderResult
  | RequestCancellation
  | RequestRefund
  | RecordRefundResult
  | ResolveIndeterminate;

export type CommandType = Command["type"];

export const COMMAND_TYPES: readonly CommandType[] = [
  "CreateTransaction",
  "SubmitQuote",
  "SubmitIntent",
  "ApproveIntent",
  "CreatePaymentInstruction",
  "RecordPaymentResult",
  "CreateOrder",
  "RecordOrderResult",
  "RequestCancellation",
  "RequestRefund",
  "RecordRefundResult",
  "ResolveIndeterminate",
] as const;
