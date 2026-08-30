import { describe, expect, it } from "vitest";
import { StepUpService } from "./step-up-service.js";
import type { StepUpSession } from "./step-up-service.js";
import { ApprovalInbox } from "./approval-inbox.js";

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

function createValidSession(overrides?: Partial<StepUpSession>): StepUpSession {
  const now = Date.now();
  return {
    principal_id: "principal-001",
    method: "webauthn",
    assurance: "substantial",
    authenticated_at: new Date(now).toISOString(),
    expires_at: new Date(now + 5 * 60 * 1000).toISOString(),
    nonce: `nonce-${Math.random().toString(36).slice(2)}`,
    ...overrides,
  };
}

function createTaskParams(overrides?: Record<string, unknown>) {
  return {
    intentRef: "intent-001",
    quoteDigest: "digest-abc123",
    transactionVersion: "v1",
    policyVersionId: "policy-v1",
    walletId: "wlt-test-001",
    merchantId: "merchant-001",
    amountPaise: 25000n,
    currency: "INR",
    expiresAt: "2099-01-01T01:00:00.000Z",
    timestamp: "2025-01-01T00:00:00.000Z",
    ...overrides,
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ApprovalInbox", () => {
  describe("task creation", () => {
    it("creates a task with correct fields", () => {
      const stepUp = new StepUpService();
      const inbox = new ApprovalInbox(stepUp);

      const task = inbox.createTask(createTaskParams());

      expect(task.taskId).toBeTruthy();
      expect(task.intentRef).toBe("intent-001");
      expect(task.quoteDigest).toBe("digest-abc123");
      expect(task.transactionVersion).toBe("v1");
      expect(task.policyVersionId).toBe("policy-v1");
      expect(task.walletId).toBe("wlt-test-001");
      expect(task.merchantId).toBe("merchant-001");
      expect(task.amountPaise).toBe(25000n);
      expect(task.currency).toBe("INR");
      expect(task.expiresAt).toBe("2099-01-01T01:00:00.000Z");
      expect(task.status).toBe("pending");
    });

    it("generates a PAYMENT_ACTION_REQUIRED notification", () => {
      const stepUp = new StepUpService();
      const inbox = new ApprovalInbox(stepUp);

      const task = inbox.createTask(createTaskParams());
      const notifications = inbox.getNotifications();

      expect(notifications).toHaveLength(1);
      const notification = notifications[0]!;
      expect(notification.type).toBe("PAYMENT_ACTION_REQUIRED");
      expect(notification.taskId).toBe(task.taskId);
      expect(notification.walletId).toBe("wlt-test-001");
      expect(notification.merchantId).toBe("merchant-001");
      expect(notification.handoffUrl).toContain(task.taskId);
    });

    it("generates handoff URL with task reference", () => {
      const stepUp = new StepUpService();
      const inbox = new ApprovalInbox(stepUp, undefined, "https://example.com/approve");

      const task = inbox.createTask(createTaskParams());
      const notifications = inbox.getNotifications();
      const notification = notifications[0]!;

      expect(notification.handoffUrl).toBe(
        `https://example.com/approve?task=${encodeURIComponent(task.taskId)}`,
      );
    });
  });

  describe("task expiry", () => {
    it("approve fails with expired task", () => {
      const stepUp = new StepUpService();
      const inbox = new ApprovalInbox(stepUp);

      const task = inbox.createTask(
        createTaskParams({
          expiresAt: "2020-01-01T00:30:00.000Z",
        }),
      );

      const result = inbox.approve(
        task.taskId,
        createValidSession(),
        "2020-01-01T00:45:00.000Z", // After expiry
      );

      expect(result.ok).toBe(false);
      expect(result.reason).toContain("expired");

      // Task should be marked expired
      const updated = inbox.getTask(task.taskId);
      expect(updated).toBeDefined();
      expect(updated!.status).toBe("expired");
    });
  });

  describe("stale invalidation", () => {
    it("invalidates tasks when quote digest changes", () => {
      const stepUp = new StepUpService();
      const inbox = new ApprovalInbox(stepUp);

      inbox.createTask(createTaskParams());

      const invalidated = inbox.invalidateStale({
        currentQuoteDigest: "new-digest-xyz",
      });

      expect(invalidated).toHaveLength(1);
      expect(invalidated[0]!.status).toBe("stale");
    });

    it("invalidates tasks when policy version changes", () => {
      const stepUp = new StepUpService();
      const inbox = new ApprovalInbox(stepUp);

      inbox.createTask(createTaskParams());

      const invalidated = inbox.invalidateStale({
        currentPolicyVersionId: "policy-v2",
      });

      expect(invalidated).toHaveLength(1);
      expect(invalidated[0]!.status).toBe("stale");
    });

    it("does not invalidate tasks that match current values", () => {
      const stepUp = new StepUpService();
      const inbox = new ApprovalInbox(stepUp);

      inbox.createTask(createTaskParams());

      const invalidated = inbox.invalidateStale({
        currentQuoteDigest: "digest-abc123",
        currentPolicyVersionId: "policy-v1",
      });

      expect(invalidated).toHaveLength(0);
    });

    it("does not invalidate non-pending tasks", () => {
      const stepUp = new StepUpService();
      const inbox = new ApprovalInbox(stepUp);

      const task = inbox.createTask(createTaskParams());
      inbox.deny(task.taskId, "principal-001", new Date().toISOString());

      const invalidated = inbox.invalidateStale({
        currentQuoteDigest: "new-digest-xyz",
      });

      expect(invalidated).toHaveLength(0);
    });
  });

  describe("approve", () => {
    it("approves with valid step-up session", () => {
      const stepUp = new StepUpService();
      const inbox = new ApprovalInbox(stepUp);

      const task = inbox.createTask(createTaskParams());
      const session = createValidSession();
      const now = new Date().toISOString();

      const result = inbox.approve(task.taskId, session, now);

      expect(result.ok).toBe(true);
      const updated = inbox.getTask(task.taskId);
      expect(updated).toBeDefined();
      expect(updated!.status).toBe("approved");
      expect(updated!.resolvedBy).toBe("principal-001");
    });

    it("rejects approval without valid step-up", () => {
      const stepUp = new StepUpService();
      const inbox = new ApprovalInbox(stepUp);

      const task = inbox.createTask(createTaskParams());
      const expiredSession = createValidSession({
        authenticated_at: "2020-01-01T00:00:00.000Z",
        expires_at: "2020-01-01T00:05:00.000Z",
      });
      const now = new Date().toISOString();

      const result = inbox.approve(task.taskId, expiredSession, now);

      expect(result.ok).toBe(false);
      expect(result.reason).toBeTruthy();
    });

    it("fails for non-existent task", () => {
      const stepUp = new StepUpService();
      const inbox = new ApprovalInbox(stepUp);

      const result = inbox.approve("nonexistent", createValidSession(), new Date().toISOString());

      expect(result.ok).toBe(false);
      expect(result.reason).toContain("not found");
    });

    it("fails for already approved task", () => {
      const stepUp = new StepUpService();
      const inbox = new ApprovalInbox(stepUp);

      const task = inbox.createTask(createTaskParams());
      const now = new Date().toISOString();
      inbox.approve(task.taskId, createValidSession(), now);

      const result = inbox.approve(task.taskId, createValidSession(), now);

      expect(result.ok).toBe(false);
      expect(result.reason).toContain("approved");
    });
  });

  describe("deny", () => {
    it("denies without step-up", () => {
      const stepUp = new StepUpService();
      const inbox = new ApprovalInbox(stepUp);

      const task = inbox.createTask(createTaskParams());
      const now = new Date().toISOString();

      const result = inbox.deny(task.taskId, "principal-001", now);

      expect(result.ok).toBe(true);
      const updated = inbox.getTask(task.taskId);
      expect(updated).toBeDefined();
      expect(updated!.status).toBe("denied");
      expect(updated!.resolvedBy).toBe("principal-001");
    });

    it("fails for non-existent task", () => {
      const stepUp = new StepUpService();
      const inbox = new ApprovalInbox(stepUp);

      const result = inbox.deny("nonexistent", "principal-001", new Date().toISOString());

      expect(result.ok).toBe(false);
      expect(result.reason).toContain("not found");
    });

    it("deny fails with expired task", () => {
      const stepUp = new StepUpService();
      const inbox = new ApprovalInbox(stepUp);

      const task = inbox.createTask(
        createTaskParams({
          expiresAt: "2020-01-01T00:30:00.000Z",
        }),
      );

      const result = inbox.deny(task.taskId, "principal-001", "2020-01-01T00:45:00.000Z");

      expect(result.ok).toBe(false);
      expect(result.reason).toContain("expired");
    });
  });

  describe("pending tasks", () => {
    it("lists pending tasks for a wallet", () => {
      const stepUp = new StepUpService();
      const inbox = new ApprovalInbox(stepUp);

      inbox.createTask(createTaskParams());
      inbox.createTask(
        createTaskParams({
          intentRef: "intent-002",
          quoteDigest: "digest-other",
        }),
      );

      const pending = inbox.getPendingTasks("wlt-test-001");
      expect(pending).toHaveLength(2);
    });

    it("does not list resolved tasks", () => {
      const stepUp = new StepUpService();
      const inbox = new ApprovalInbox(stepUp);

      const task1 = inbox.createTask(createTaskParams());
      inbox.createTask(
        createTaskParams({
          intentRef: "intent-002",
          quoteDigest: "digest-other",
        }),
      );
      inbox.deny(task1.taskId, "principal-001", new Date().toISOString());

      const pending = inbox.getPendingTasks("wlt-test-001");
      expect(pending).toHaveLength(1);
    });
  });
});
