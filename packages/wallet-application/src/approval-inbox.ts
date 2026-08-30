/**
 * Approval inbox service.
 *
 * Manages approval tasks with version/expiry-bound semantics:
 * - Tasks are bound to (intentRef + quoteDigest + transactionVersion + expiresAt)
 * - Approve requires step-up via StepUpService
 * - Deny does not require step-up
 * - Stale detection: material change in quote/policy invalidates tasks
 * - PAYMENT_ACTION_REQUIRED notification records
 * - Browser handoff URL generation
 * - Persistence via ApprovalTaskStore port
 */

import { createHash } from "node:crypto";
import type { StepUpSession } from "./step-up-service.js";
import type { StepUpService } from "./step-up-service.js";

// ---------------------------------------------------------------------------
// Approval Task
// ---------------------------------------------------------------------------

export const APPROVAL_TASK_STATUSES = [
  "pending",
  "approved",
  "denied",
  "expired",
  "stale",
] as const;

export type ApprovalTaskStatus = (typeof APPROVAL_TASK_STATUSES)[number];

export interface ApprovalTask {
  readonly taskId: string;
  readonly intentRef: string;
  readonly quoteDigest: string;
  readonly transactionVersion: string;
  readonly policyVersionId: string;
  readonly walletId: string;
  readonly merchantId: string;
  readonly amountPaise: bigint;
  readonly currency: string;
  readonly expiresAt: string;
  readonly createdAt: string;
  readonly status: ApprovalTaskStatus;
  readonly resolvedAt?: string | undefined;
  readonly resolvedBy?: string | undefined;
}

// ---------------------------------------------------------------------------
// Notification Record
// ---------------------------------------------------------------------------

export interface NotificationRecord {
  readonly notificationId: string;
  readonly type: "PAYMENT_ACTION_REQUIRED";
  readonly taskId: string;
  readonly walletId: string;
  readonly merchantId: string;
  readonly amountPaise: bigint;
  readonly currency: string;
  readonly createdAt: string;
  readonly handoffUrl: string;
}

// ---------------------------------------------------------------------------
// Approval Result
// ---------------------------------------------------------------------------

export interface ApprovalResult {
  readonly ok: boolean;
  readonly reason?: string;
}

// ---------------------------------------------------------------------------
// Approval Task Store (persistence port)
// ---------------------------------------------------------------------------

/**
 * Port for approval task persistence.
 * Implementations may be in-memory (tests) or database-backed (production).
 */
export interface ApprovalTaskStore {
  save(task: ApprovalTask): void;
  get(taskId: string): ApprovalTask | undefined;
  findByWalletAndStatus(walletId: string, status: ApprovalTaskStatus): readonly ApprovalTask[];
  listAll(): readonly ApprovalTask[];
}

/**
 * In-memory implementation of ApprovalTaskStore for testing.
 */
export class InMemoryApprovalTaskStore implements ApprovalTaskStore {
  readonly #tasks = new Map<string, ApprovalTask>();

  save(task: ApprovalTask): void {
    this.#tasks.set(task.taskId, task);
  }

  get(taskId: string): ApprovalTask | undefined {
    return this.#tasks.get(taskId);
  }

  findByWalletAndStatus(walletId: string, status: ApprovalTaskStatus): readonly ApprovalTask[] {
    return [...this.#tasks.values()].filter((t) => t.walletId === walletId && t.status === status);
  }

  listAll(): readonly ApprovalTask[] {
    return [...this.#tasks.values()];
  }
}

// ---------------------------------------------------------------------------
// Approval Inbox
// ---------------------------------------------------------------------------

export class ApprovalInbox {
  readonly #store: ApprovalTaskStore;
  readonly #notifications: NotificationRecord[] = [];
  readonly #stepUpService: StepUpService;
  readonly #handoffBaseUrl: string;

  constructor(stepUpService: StepUpService, store?: ApprovalTaskStore, handoffBaseUrl?: string) {
    this.#stepUpService = stepUpService;
    this.#store = store ?? new InMemoryApprovalTaskStore();
    this.#handoffBaseUrl = handoffBaseUrl ?? "https://wallet.counter.dev/approve";
  }

  /**
   * Creates an approval task bound to the given parameters.
   * Generates a PAYMENT_ACTION_REQUIRED notification record.
   */
  createTask(params: {
    readonly intentRef: string;
    readonly quoteDigest: string;
    readonly transactionVersion: string;
    readonly policyVersionId: string;
    readonly walletId: string;
    readonly merchantId: string;
    readonly amountPaise: bigint;
    readonly currency: string;
    readonly expiresAt: string;
    readonly timestamp: string;
  }): ApprovalTask {
    const {
      intentRef,
      quoteDigest,
      transactionVersion,
      policyVersionId,
      walletId,
      merchantId,
      amountPaise,
      currency,
      expiresAt,
      timestamp,
    } = params;

    const taskId = createHash("sha256")
      .update(`task:${intentRef}:${quoteDigest}:${transactionVersion}`)
      .digest("base64url")
      .slice(0, 22);

    const task: ApprovalTask = {
      taskId,
      intentRef,
      quoteDigest,
      transactionVersion,
      policyVersionId,
      walletId,
      merchantId,
      amountPaise,
      currency,
      expiresAt,
      createdAt: timestamp,
      status: "pending",
    };

    this.#store.save(task);

    // Generate notification record
    const handoffUrl = this.#generateHandoffUrl(taskId);
    const notification: NotificationRecord = {
      notificationId: createHash("sha256")
        .update(`notification:${taskId}:${timestamp}`)
        .digest("base64url")
        .slice(0, 22),
      type: "PAYMENT_ACTION_REQUIRED",
      taskId,
      walletId,
      merchantId,
      amountPaise,
      currency,
      createdAt: timestamp,
      handoffUrl,
    };

    this.#notifications.push(notification);

    return task;
  }

  /**
   * Approves a task. Requires step-up validation.
   */
  approve(taskId: string, session: StepUpSession, now: string): ApprovalResult {
    const task = this.#store.get(taskId);
    if (!task) {
      return { ok: false, reason: "Task not found" };
    }

    if (task.status !== "pending") {
      return { ok: false, reason: `Task is ${task.status}, cannot approve` };
    }

    // Check expiry
    if (now >= task.expiresAt) {
      this.#store.save({ ...task, status: "expired", resolvedAt: now });
      return { ok: false, reason: "Task has expired" };
    }

    // Require step-up
    const stepUpReq = this.#stepUpService.requireStepUp("approval", session);
    if (stepUpReq.required) {
      return { ok: false, reason: stepUpReq.reason ?? "Step-up authentication required" };
    }

    // Consume nonce to prevent replay
    this.#stepUpService.consumeNonce(session.nonce);

    this.#store.save({
      ...task,
      status: "approved",
      resolvedAt: now,
      resolvedBy: session.principal_id,
    });

    return { ok: true };
  }

  /**
   * Denies a task. Does NOT require step-up.
   */
  deny(taskId: string, principalId: string, now: string): ApprovalResult {
    const task = this.#store.get(taskId);
    if (!task) {
      return { ok: false, reason: "Task not found" };
    }

    if (task.status !== "pending") {
      return { ok: false, reason: `Task is ${task.status}, cannot deny` };
    }

    // Check expiry
    if (now >= task.expiresAt) {
      this.#store.save({ ...task, status: "expired", resolvedAt: now });
      return { ok: false, reason: "Task has expired" };
    }

    this.#store.save({
      ...task,
      status: "denied",
      resolvedAt: now,
      resolvedBy: principalId,
    });

    return { ok: true };
  }

  /**
   * Detects stale tasks: a material change in quote digest or policy version
   * invalidates any pending task that was created against the old values.
   */
  invalidateStale(params: {
    readonly currentQuoteDigest?: string;
    readonly currentPolicyVersionId?: string;
  }): readonly ApprovalTask[] {
    const { currentQuoteDigest, currentPolicyVersionId } = params;
    const invalidated: ApprovalTask[] = [];

    for (const task of this.#store.listAll()) {
      if (task.status !== "pending") {
        continue;
      }

      let isStale = false;

      if (currentQuoteDigest !== undefined && task.quoteDigest !== currentQuoteDigest) {
        isStale = true;
      }

      if (currentPolicyVersionId !== undefined && task.policyVersionId !== currentPolicyVersionId) {
        isStale = true;
      }

      if (isStale) {
        const staleTask = { ...task, status: "stale" as const };
        this.#store.save(staleTask);
        invalidated.push(staleTask);
      }
    }

    return invalidated;
  }

  /**
   * Gets a task by ID.
   */
  getTask(taskId: string): ApprovalTask | undefined {
    return this.#store.get(taskId);
  }

  /**
   * Gets all pending tasks for a wallet.
   */
  getPendingTasks(walletId: string): readonly ApprovalTask[] {
    return this.#store.findByWalletAndStatus(walletId, "pending");
  }

  /**
   * Gets all notification records.
   */
  getNotifications(): readonly NotificationRecord[] {
    return [...this.#notifications];
  }

  /**
   * Generates the browser handoff URL for a task.
   */
  #generateHandoffUrl(taskId: string): string {
    return `${this.#handoffBaseUrl}?task=${encodeURIComponent(taskId)}`;
  }
}
