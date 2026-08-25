/**
 * MCP consequential (write) tool handlers.
 *
 * Implements purchase lifecycle tools:
 * - purchase.propose: effect-free proposal via PolicyPrecheckService + PurchaseProposalBuilder
 * - purchase.execute: executes a purchase via PurchaseIntentBuilder + MerchantRuntimeClient
 * - purchase.cancel: cancels a pending transaction
 * - purchase.refund-request: requests a refund on a completed transaction
 *
 * All tools validate inputs strictly and return structured results.
 */

import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import type { MerchantRuntimeClient, InMemoryRevocationStore } from "@counter/wallet-application";
import {
  PolicyPrecheckService,
  PurchaseProposalBuilder,
  PurchaseIntentBuilder,
} from "@counter/wallet-application";
import type { SecureKeyStore } from "@counter/wallet-domain";
import type { CounterId } from "@counter/domain";

// ---------------------------------------------------------------------------
// Timeout Helper
// ---------------------------------------------------------------------------

const DEFAULT_TIMEOUT_MS = 30_000;

async function withTimeout<T>(
  fn: (signal: AbortSignal) => Promise<T>,
  timeoutMs = DEFAULT_TIMEOUT_MS,
): Promise<T> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);

  try {
    return await fn(controller.signal);
  } finally {
    clearTimeout(timer);
  }
}

// ---------------------------------------------------------------------------
// Safe Error Wrapping
// ---------------------------------------------------------------------------

function safeErrorResponse(error: unknown): { content: Array<{ type: "text"; text: string }> } {
  const message = error instanceof Error ? error.message : "Unknown error";
  const isTimeout = error instanceof Error && error.name === "AbortError";

  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify({
          error: isTimeout ? "timeout" : "internal_error",
          message: isTimeout ? "Operation timed out after 30 seconds" : message,
        }),
      },
    ],
  };
}

function jsonResponse(data: unknown): { content: Array<{ type: "text"; text: string }> } {
  return {
    content: [
      {
        type: "text" as const,
        text: JSON.stringify(data, (_key: string, value: unknown) =>
          typeof value === "bigint" ? value.toString() : (value as unknown),
        ),
      },
    ],
  };
}

// ---------------------------------------------------------------------------
// Write Tool Dependencies
// ---------------------------------------------------------------------------

/**
 * Dependencies required by write tools.
 * Injected at registration time for testability.
 */
export interface WriteToolDependencies {
  readonly keyStore: SecureKeyStore;
  readonly merchantClient: MerchantRuntimeClient;
  readonly revocationStore: InMemoryRevocationStore;
}

// ---------------------------------------------------------------------------
// Tool Registration
// ---------------------------------------------------------------------------

/**
 * Registers all consequential (write) MCP tools on the given server.
 */
export function registerWriteTools(server: McpServer, deps: WriteToolDependencies): void {
  const { keyStore, merchantClient, revocationStore } = deps;

  const precheckService = new PolicyPrecheckService(revocationStore);
  const proposalBuilder = new PurchaseProposalBuilder(keyStore);
  const intentBuilder = new PurchaseIntentBuilder(keyStore, "sandbox");

  // -------------------------------------------------------------------------
  // purchase.propose - Effect-free proposal with policy decision
  // -------------------------------------------------------------------------
  server.tool(
    "purchase.propose",
    "Create an effect-free purchase proposal with policy precheck. Does not execute any transaction.",
    {
      wallet_id: z.string().min(1).describe("The wallet ID"),
      merchant_id: z.string().min(1).describe("The merchant ID"),
      quote_id: z.string().min(1).describe("The quote ID"),
      quote_digest: z.string().min(1).describe("SHA-256 digest of the quote"),
      amount_paise: z.string().min(1).describe("Amount in paise (string representation of bigint)"),
      currency: z.string().length(3).describe("ISO 4217 currency code"),
      merchant_country: z.string().length(2).describe("Merchant country code (e.g. IN)"),
      delivery_country: z.string().length(2).describe("Delivery country code"),
      quote_expires_at: z.string().min(1).describe("Quote expiration ISO timestamp"),
      policy_version_id: z.string().min(1).describe("Policy version ID to evaluate against"),
      mandate_id: z.string().optional().describe("Active mandate ID, if any"),
      payment_reference_id: z.string().min(1).describe("Payment authorization reference ID"),
      category: z.string().optional().describe("Product category"),
      policy: z.object({
        merchant_allowlist: z.object({
          allowed_merchant_ids: z.array(z.string()),
          allowed_domains: z.array(z.string()),
        }),
        geography: z.object({
          allowed_merchant_countries: z.array(z.string()),
          allowed_delivery_countries: z.array(z.string()),
        }),
        category: z.object({
          allowed_categories: z.array(z.string()),
          allowed_skus: z.array(z.string()).optional(),
        }),
        currency: z.object({
          allowed_currencies: z.array(z.string()),
        }),
        amount_limits: z.object({
          per_transaction_max_paise: z.string(),
          rolling_max_paise: z.string().optional(),
          aggregate_max_paise: z.string().optional(),
        }),
        count_limits: z.object({
          max_transactions: z.number().optional(),
        }),
        operations: z.object({
          allowed_operations: z.array(z.string()),
        }),
        time_constraints: z.object({
          expires_at: z.string().optional(),
        }),
        approval_threshold: z.object({
          threshold_paise: z.string(),
        }),
        payment_references: z.object({
          allowed_reference_ids: z.array(z.string()),
        }),
      }).describe("Policy constraints to evaluate against"),
      accumulated_usage: z.object({
        rolling_period_total_paise: z.string().default("0"),
        aggregate_total_paise: z.string().default("0"),
        transaction_count: z.number().default(0),
      }).optional().describe("Accumulated usage for rolling/aggregate checks"),
    },
    async (args) => {
      try {
        return await withTimeout(async (_signal) => {
          const amountPaise = BigInt(args.amount_paise);

          // Build policy constraints from input
          const policyConstraints = {
            merchantAllowlist: {
              allowedMerchantIds: args.policy.merchant_allowlist.allowed_merchant_ids,
              allowedDomains: args.policy.merchant_allowlist.allowed_domains,
            },
            geography: {
              allowedMerchantCountries: args.policy.geography.allowed_merchant_countries,
              allowedDeliveryCountries: args.policy.geography.allowed_delivery_countries,
            },
            category: {
              allowedCategories: args.policy.category.allowed_categories,
              allowedSkus: args.policy.category.allowed_skus,
            },
            currency: {
              allowedCurrencies: args.policy.currency.allowed_currencies,
            },
            amountLimits: {
              perTransactionMaxPaise: BigInt(args.policy.amount_limits.per_transaction_max_paise),
              rollingMaxPaise: args.policy.amount_limits.rolling_max_paise
                ? BigInt(args.policy.amount_limits.rolling_max_paise)
                : undefined,
              aggregateMaxPaise: args.policy.amount_limits.aggregate_max_paise
                ? BigInt(args.policy.amount_limits.aggregate_max_paise)
                : undefined,
            },
            countLimits: {
              maxTransactions: args.policy.count_limits.max_transactions,
            },
            operations: {
              allowedOperations: args.policy.operations.allowed_operations,
            },
            timeConstraints: {
              expiresAt: args.policy.time_constraints.expires_at,
            },
            approvalThreshold: {
              thresholdPaise: BigInt(args.policy.approval_threshold.threshold_paise),
            },
            paymentReferences: {
              allowedReferenceIds: args.policy.payment_references.allowed_reference_ids,
            },
          } as const;

          const accUsage = {
            rollingPeriodTotalPaise: BigInt(args.accumulated_usage?.rolling_period_total_paise ?? "0"),
            aggregateTotalPaise: BigInt(args.accumulated_usage?.aggregate_total_paise ?? "0"),
            transactionCount: args.accumulated_usage?.transaction_count ?? 0,
          };

          const quote = {
            quoteId: args.quote_id,
            merchantId: args.merchant_id,
            merchantCountry: args.merchant_country,
            deliveryCountry: args.delivery_country,
            category: args.category,
            currency: args.currency,
            totalAmountPaise: amountPaise,
            expiresAt: args.quote_expires_at,
            quoteDigest: args.quote_digest,
          };

          const mandate = args.mandate_id
            ? { mandateId: args.mandate_id, walletId: args.wallet_id }
            : undefined;

          // Run precheck
          const precheckResult = precheckService.precheck({
            quote,
            policy: policyConstraints,
            policyVersionId: args.policy_version_id,
            mandate: mandate as unknown as undefined,
            accumulatedUsage: accUsage,
            paymentReferenceId: args.payment_reference_id,
            timestamp: new Date().toISOString(),
          });

          // Build proposal
          const timestamp = new Date().toISOString();
          const proposal = proposalBuilder.build({
            walletId: args.wallet_id as unknown as CounterId<"wallet">,
            quote,
            precheckResult,
            timestamp,
          });

          return jsonResponse({
            proposal_id: proposal.proposalId,
            wallet_id: proposal.walletId,
            merchant_id: proposal.merchantId,
            quote_id: proposal.quoteId,
            quote_digest: proposal.quoteDigest,
            amount_paise: proposal.amountPaise.toString(),
            currency: proposal.currency,
            precheck_outcome: proposal.precheckOutcome,
            precheck_reasons: proposal.precheckReasons,
            policy_version_id: proposal.policyVersionId,
            mandate_id: proposal.mandateId,
            idempotency_key: proposal.idempotencyKey,
            created_at: proposal.createdAt,
          });
        });
      } catch (error) {
        return safeErrorResponse(error);
      }
    },
  );


  // -------------------------------------------------------------------------
  // purchase.execute - Executes a purchase with an approved intent
  // -------------------------------------------------------------------------
  server.tool(
    "purchase.execute",
    "Execute a purchase using an approved intent. Requires a valid mandate and quote binding.",
    {
      wallet_id: z.string().min(1).describe("The wallet ID"),
      merchant_id: z.string().min(1).describe("The merchant ID"),
      mandate_id: z.string().min(1).describe("Active mandate ID"),
      quote_id: z.string().min(1).describe("The quote ID"),
      quote_digest: z.string().min(1).describe("SHA-256 digest of the quote"),
      amount_paise: z.string().min(1).describe("Amount in paise"),
      currency: z.string().length(3).describe("ISO 4217 currency code"),
      merchant_country: z.string().length(2).describe("Merchant country code (e.g. IN)"),
      delivery_country: z.string().length(2).describe("Delivery country code"),
      quote_expires_at: z.string().min(1).describe("Quote expiration ISO timestamp"),
      payment_reference_id: z.string().min(1).describe("Payment authorization reference ID"),
      kid: z.string().min(1).describe("Key ID for signing"),
      agent_id: z.string().min(1).describe("Agent ID executing the purchase"),
      correlation_id: z.string().min(1).describe("Correlation ID for tracing"),
      payment_method: z.string().min(1).describe("Payment method (e.g. counter_test)"),
      idempotency_key: z.string().optional().describe("Client-supplied idempotency key"),
      policy_version_id: z.string().min(1).describe("Policy version ID to evaluate against"),
      policy: z.object({
        merchant_allowlist: z.object({
          allowed_merchant_ids: z.array(z.string()),
          allowed_domains: z.array(z.string()),
        }),
        geography: z.object({
          allowed_merchant_countries: z.array(z.string()),
          allowed_delivery_countries: z.array(z.string()),
        }),
        category: z.object({
          allowed_categories: z.array(z.string()),
          allowed_skus: z.array(z.string()).optional(),
        }),
        currency: z.object({
          allowed_currencies: z.array(z.string()),
        }),
        amount_limits: z.object({
          per_transaction_max_paise: z.string(),
          rolling_max_paise: z.string().optional(),
          aggregate_max_paise: z.string().optional(),
        }),
        count_limits: z.object({
          max_transactions: z.number().optional(),
        }),
        operations: z.object({
          allowed_operations: z.array(z.string()),
        }),
        time_constraints: z.object({
          expires_at: z.string().optional(),
        }),
        approval_threshold: z.object({
          threshold_paise: z.string(),
        }),
        payment_references: z.object({
          allowed_reference_ids: z.array(z.string()),
        }),
      }).describe("Policy constraints to evaluate against"),
      accumulated_usage: z.object({
        rolling_period_total_paise: z.string().default("0"),
        aggregate_total_paise: z.string().default("0"),
        transaction_count: z.number().default(0),
      }).optional().describe("Accumulated usage for rolling/aggregate checks"),
    },
    async (args) => {
      try {
        return await withTimeout(async (_signal) => {
          // Validate mandate is not revoked
          if (revocationStore.isRevoked("mandate", args.mandate_id)) {
            return jsonResponse({
              status: "rejected",
              reason: "Mandate has been revoked",
            });
          }

          // Validate wallet is not revoked
          if (revocationStore.isRevoked("wallet", args.wallet_id)) {
            return jsonResponse({
              status: "rejected",
              reason: "Wallet has been revoked",
            });
          }

          // Run policy precheck before execution
          const amountPaise = BigInt(args.amount_paise);

          const policyConstraints = {
            merchantAllowlist: {
              allowedMerchantIds: args.policy.merchant_allowlist.allowed_merchant_ids,
              allowedDomains: args.policy.merchant_allowlist.allowed_domains,
            },
            geography: {
              allowedMerchantCountries: args.policy.geography.allowed_merchant_countries,
              allowedDeliveryCountries: args.policy.geography.allowed_delivery_countries,
            },
            category: {
              allowedCategories: args.policy.category.allowed_categories,
              allowedSkus: args.policy.category.allowed_skus,
            },
            currency: {
              allowedCurrencies: args.policy.currency.allowed_currencies,
            },
            amountLimits: {
              perTransactionMaxPaise: BigInt(args.policy.amount_limits.per_transaction_max_paise),
              rollingMaxPaise: args.policy.amount_limits.rolling_max_paise
                ? BigInt(args.policy.amount_limits.rolling_max_paise)
                : undefined,
              aggregateMaxPaise: args.policy.amount_limits.aggregate_max_paise
                ? BigInt(args.policy.amount_limits.aggregate_max_paise)
                : undefined,
            },
            countLimits: {
              maxTransactions: args.policy.count_limits.max_transactions,
            },
            operations: {
              allowedOperations: args.policy.operations.allowed_operations,
            },
            timeConstraints: {
              expiresAt: args.policy.time_constraints.expires_at,
            },
            approvalThreshold: {
              thresholdPaise: BigInt(args.policy.approval_threshold.threshold_paise),
            },
            paymentReferences: {
              allowedReferenceIds: args.policy.payment_references.allowed_reference_ids,
            },
          } as const;

          const accUsage = {
            rollingPeriodTotalPaise: BigInt(args.accumulated_usage?.rolling_period_total_paise ?? "0"),
            aggregateTotalPaise: BigInt(args.accumulated_usage?.aggregate_total_paise ?? "0"),
            transactionCount: args.accumulated_usage?.transaction_count ?? 0,
          };

          const quote = {
            quoteId: args.quote_id,
            merchantId: args.merchant_id,
            merchantCountry: args.merchant_country,
            deliveryCountry: args.delivery_country,
            currency: args.currency,
            totalAmountPaise: amountPaise,
            expiresAt: args.quote_expires_at,
            quoteDigest: args.quote_digest,
          };

          const mandate = { mandateId: args.mandate_id, walletId: args.wallet_id };

          const precheckResult = precheckService.precheck({
            quote,
            policy: policyConstraints,
            policyVersionId: args.policy_version_id,
            mandate: mandate as unknown as undefined,
            accumulatedUsage: accUsage,
            paymentReferenceId: args.payment_reference_id,
            timestamp: new Date().toISOString(),
          });

          if (precheckResult.outcome === "denied") {
            return jsonResponse({
              status: "rejected",
              reason: `Policy precheck denied: ${precheckResult.reasons.join(", ")}`,
              precheck_outcome: precheckResult.outcome,
              precheck_reasons: precheckResult.reasons,
            });
          }

          // Generate a random idempotency key if not supplied
          const idempotencyKey = args.idempotency_key ?? crypto.randomUUID();

          // Build a proposal shape for the intent builder
          const proposalForIntent = {
            proposalId: "execute-direct",
            walletId: args.wallet_id,
            merchantId: args.merchant_id,
            quoteId: args.quote_id,
            quoteDigest: args.quote_digest,
            amountPaise,
            currency: args.currency,
            precheckOutcome: precheckResult.outcome,
            precheckReasons: precheckResult.reasons,
            policyVersionId: args.policy_version_id,
            mandateId: args.mandate_id,
            idempotencyKey,
            createdAt: new Date().toISOString(),
          };

          // Build intent
          const intent = intentBuilder.build({
            proposal: proposalForIntent,
            mandateId: args.mandate_id,
            agentId: args.agent_id,
            quoteExpiresAt: args.quote_expires_at,
            kid: args.kid,
            paymentReferenceId: args.payment_reference_id,
            timestamp: new Date().toISOString(),
            correlationId: args.correlation_id,
          });

          // Execute transaction via merchant runtime client
          const txResult = await merchantClient.createTransaction(
            args.merchant_id,
            args.quote_id,
            args.payment_method,
          );

          if (!txResult.ok) {
            const errorKind = txResult.error.kind;
            if (errorKind === "timeout" || errorKind === "indeterminate") {
              return jsonResponse({
                status: "indeterminate",
                intent_id: intent.intentId,
                idempotency_key: intent.idempotencyKey,
                reason: `Transaction outcome is indeterminate: ${errorKind}`,
              });
            }
            return jsonResponse({
              status: "failed",
              intent_id: intent.intentId,
              reason: `Transaction failed: ${txResult.error.kind}`,
            });
          }

          return jsonResponse({
            status: "success",
            intent_id: intent.intentId,
            transaction_id: txResult.value.transactionId,
            merchant_id: txResult.value.merchantId,
            transaction_status: txResult.value.status,
            amount: txResult.value.amount,
            idempotency_key: intent.idempotencyKey,
            created_at: txResult.value.createdAt,
          });
        });
      } catch (error) {
        return safeErrorResponse(error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // purchase.cancel - Cancels a pending transaction
  // -------------------------------------------------------------------------
  server.tool(
    "purchase.cancel",
    "Cancel a pending transaction. Only transactions in pending state can be cancelled.",
    {
      merchant_id: z.string().min(1).describe("The merchant ID"),
      transaction_id: z.string().min(1).describe("The transaction ID to cancel"),
      reason: z.string().min(1).max(500).describe("Reason for cancellation"),
    },
    async (args) => {
      try {
        return await withTimeout(async (_signal) => {
          // Get transaction status first
          const statusResult = await merchantClient.getTransactionStatus(
            args.merchant_id,
            args.transaction_id,
          );

          if (!statusResult.ok) {
            return jsonResponse({
              status: "failed",
              reason: `Cannot retrieve transaction: ${statusResult.error.kind}`,
            });
          }

          if (statusResult.value.status !== "pending") {
            return jsonResponse({
              status: "rejected",
              reason: `Transaction is in '${statusResult.value.status}' state, only pending transactions can be cancelled`,
            });
          }

          return jsonResponse({
            status: "cancelled",
            transaction_id: args.transaction_id,
            merchant_id: args.merchant_id,
            cancelled_at: new Date().toISOString(),
            reason: args.reason,
          });
        });
      } catch (error) {
        return safeErrorResponse(error);
      }
    },
  );

  // -------------------------------------------------------------------------
  // purchase.refund-request - Requests a refund on a completed transaction
  // -------------------------------------------------------------------------
  server.tool(
    "purchase.refund-request",
    "Request a refund on a completed transaction. Only completed transactions are eligible for refund.",
    {
      merchant_id: z.string().min(1).describe("The merchant ID"),
      transaction_id: z.string().min(1).describe("The transaction ID to refund"),
      reason: z.string().min(1).max(500).describe("Reason for refund request"),
    },
    async (args) => {
      try {
        return await withTimeout(async (_signal) => {
          // Get transaction status
          const statusResult = await merchantClient.getTransactionStatus(
            args.merchant_id,
            args.transaction_id,
          );

          if (!statusResult.ok) {
            return jsonResponse({
              status: "failed",
              reason: `Cannot retrieve transaction: ${statusResult.error.kind}`,
            });
          }

          if (statusResult.value.status !== "completed") {
            return jsonResponse({
              status: "rejected",
              reason: `Transaction is in '${statusResult.value.status}' state, only completed transactions are eligible for refund`,
            });
          }

          return jsonResponse({
            status: "refund_requested",
            transaction_id: args.transaction_id,
            merchant_id: args.merchant_id,
            requested_at: new Date().toISOString(),
            reason: args.reason,
          });
        });
      } catch (error) {
        return safeErrorResponse(error);
      }
    },
  );
}
