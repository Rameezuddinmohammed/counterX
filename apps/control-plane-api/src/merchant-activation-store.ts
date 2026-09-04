/**
 * The final gate in self-serve merchant onboarding: ACTIVATION_REVIEW ->
 * ACTIVE.
 *
 * Every earlier lifecycle transition in this wizard (DRAFT -> ... ->
 * ACTIVATION_REVIEW, see merchant-application-store.ts, merchant-readiness-
 * store.ts, merchant-manifest-store.ts) is driven by the merchant's OWN
 * session. This one deliberately is not: a merchant cannot self-approve into
 * ACTIVE, because that is the point at which merchant-directory-store.ts (in
 * apps/agent-runtime) starts showing them to real buyer agents as a live,
 * money-accepting merchant. This store's ONLY caller is
 * merchant-activation-routes.ts, which requires a real `operator`-kind
 * actor (platform.operator role, platform scope) — see that file's header
 * for the authorization shape.
 *
 * Every transition goes through transitionMerchantLifecycle() (packages/
 * merchant-application/src/lifecycle.ts), exactly like every other store in
 * this app that touches lifecycle_state — never a raw UPDATE.
 */
import type { Environment, MerchantId, OperatorId } from "@counter/domain";
import { instantFromEpochMilliseconds, parseCounterId, type Instant } from "@counter/domain";
import type { TransactionalDatabase } from "@counter/data";
import {
  transitionMerchantLifecycle,
  isMerchantLifecycleState,
  type MerchantLifecycleState,
} from "@counter/merchant-application";

/** A client-caused failure (unknown merchant, not yet ACTIVATION_REVIEW) — maps to 400/404 at the route layer. */
export class MerchantActivationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "MerchantActivationError";
  }
}

export interface MerchantActivationResult {
  readonly merchantId: string;
  readonly lifecycleState: MerchantLifecycleState;
  readonly lifecycleVersion: number;
}

export interface MerchantActivationStoreLike {
  /**
   * Throws MerchantActivationError if the merchant doesn't exist or isn't
   * currently in ACTIVATION_REVIEW. Idempotent: a merchant already ACTIVE
   * is returned as-is rather than erroring, so a repeat approve click (or a
   * retried script invocation) is safe.
   */
  approve(
    merchantId: string,
    operatorId: string,
    reason: string,
  ): Promise<MerchantActivationResult>;
}

function nowInstant(): Instant {
  const result = instantFromEpochMilliseconds(Date.now());
  if (!result.ok) {
    throw new Error("Failed to derive the current instant");
  }
  return result.value;
}

export class MerchantActivationStore implements MerchantActivationStoreLike {
  constructor(
    private readonly database: TransactionalDatabase,
    private readonly environment: Environment,
  ) {}

  async approve(
    merchantId: string,
    operatorId: string,
    reason: string,
  ): Promise<MerchantActivationResult> {
    const parsedMerchantId = parseCounterId(merchantId, "merchant");
    if (!parsedMerchantId.ok) {
      throw new MerchantActivationError(`Invalid merchantId: ${parsedMerchantId.error.message}`);
    }
    const parsedOperatorId = parseCounterId(operatorId, "operator");
    if (!parsedOperatorId.ok) {
      throw new MerchantActivationError(`Invalid operatorId: ${parsedOperatorId.error.message}`);
    }
    if (reason.trim().length === 0) {
      throw new MerchantActivationError("reason must not be empty");
    }

    return this.database.transaction(async (session) => {
      const existing = await session.query<{
        lifecycle_state: string;
        lifecycle_version: number;
      }>(
        `SELECT lifecycle_state, lifecycle_version FROM merchant.onboarding_applications
          WHERE environment = $1 AND merchant_id = $2
          FOR UPDATE`,
        [this.environment, merchantId],
      );
      const row = existing.rows[0];
      if (row === undefined) {
        throw new MerchantActivationError(`No such merchant application: ${merchantId}`);
      }
      if (!isMerchantLifecycleState(row.lifecycle_state)) {
        throw new Error("Corrupt onboarding application row: invalid lifecycle_state");
      }

      // Idempotent: already ACTIVE — a repeat approve is a no-op, not an
      // error (a retried script/click must not fail just because it worked
      // the first time).
      if (row.lifecycle_state === "ACTIVE") {
        return {
          merchantId,
          lifecycleState: row.lifecycle_state,
          lifecycleVersion: row.lifecycle_version,
        };
      }

      if (row.lifecycle_state !== "ACTIVATION_REVIEW") {
        throw new MerchantActivationError(
          `Merchant is not in ACTIVATION_REVIEW (currently ${row.lifecycle_state}) — cannot approve to ACTIVE`,
        );
      }

      const transition = transitionMerchantLifecycle({
        merchantId: parsedMerchantId.value as MerchantId,
        currentState: row.lifecycle_state,
        targetState: "ACTIVE",
        actor: { kind: "operator", id: parsedOperatorId.value as OperatorId },
        reason,
        occurredAt: nowInstant(),
        currentVersion: row.lifecycle_version,
      });
      if (!transition.ok) {
        throw new MerchantActivationError(transition.error.message);
      }

      const now = new Date().toISOString();
      const updated = await session.query<{
        lifecycle_state: string;
        lifecycle_version: number;
      }>(
        `UPDATE merchant.onboarding_applications
            SET lifecycle_state = $3, lifecycle_version = $4, updated_at = $5
          WHERE environment = $1 AND merchant_id = $2
        RETURNING lifecycle_state, lifecycle_version`,
        [this.environment, merchantId, transition.value.toState, transition.value.version, now],
      );
      const updatedRow = updated.rows[0];
      if (updatedRow === undefined || !isMerchantLifecycleState(updatedRow.lifecycle_state)) {
        throw new Error("Failed to persist ACTIVATION_REVIEW -> ACTIVE transition");
      }

      return {
        merchantId,
        lifecycleState: updatedRow.lifecycle_state,
        lifecycleVersion: updatedRow.lifecycle_version,
      };
    });
  }
}
