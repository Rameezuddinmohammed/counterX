import { CryptoIdGenerator } from "@counter/domain";
import type { Instant } from "@counter/domain";
import { describe, expect, it } from "vitest";
import { InMemoryJobRepository } from "./in-memory-job-repository.js";
import type { JobInput } from "./job-repository.js";

const idGen = new CryptoIdGenerator();

function makeJobInput(overrides?: Partial<JobInput>): JobInput {
  return {
    id: idGen.generate("job"),
    type: "process-payment",
    payload: { transactionId: "txn_123" },
    correlationId: undefined,
    availableAt: 1_700_000_000_000 as Instant,
    maxAttempts: 3,
    ...overrides,
  };
}

describe("InMemoryJobRepository", () => {
  const now = 1_700_000_000_000 as Instant;
  const later = 1_700_000_010_000 as Instant;
  const leaseDurationMs = 30_000;

  it("enqueues a job with available status", () => {
    const repo = new InMemoryJobRepository();
    const input = makeJobInput();
    const result = repo.enqueue(input, now);

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.status).toBe("available");
    expect(result.value.attemptCount).toBe(0);
    expect(result.value.createdAt).toBe(now);
  });

  it("claims available jobs of matching type", () => {
    const repo = new InMemoryJobRepository();
    const input = makeJobInput();
    repo.enqueue(input, now);

    const result = repo.claim(["process-payment"], "worker-1", leaseDurationMs, now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.status).toBe("leased");
    expect(result.value[0]!.leaseOwner).toBe("worker-1");
    expect(result.value[0]!.leaseExpiresAt).toBe(now + leaseDurationMs);
    expect(result.value[0]!.attemptCount).toBe(1);
  });

  it("does not claim jobs with non-matching type", () => {
    const repo = new InMemoryJobRepository();
    const input = makeJobInput({ type: "send-notification" });
    repo.enqueue(input, now);

    const result = repo.claim(["process-payment"], "worker-1", leaseDurationMs, now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it("does not claim jobs where availableAt is in the future", () => {
    const repo = new InMemoryJobRepository();
    const futureTime = (now + 60_000) as Instant;
    const input = makeJobInput({ availableAt: futureTime });
    repo.enqueue(input, now);

    const result = repo.claim(["process-payment"], "worker-1", leaseDurationMs, now);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it("does not claim already leased jobs with valid lease", () => {
    const repo = new InMemoryJobRepository();
    const input = makeJobInput();
    repo.enqueue(input, now);

    // First worker claims
    repo.claim(["process-payment"], "worker-1", leaseDurationMs, now);

    // Second worker tries to claim while lease is valid
    const result = repo.claim(["process-payment"], "worker-2", leaseDurationMs, later);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it("claims jobs with expired leases (worker takeover)", () => {
    const repo = new InMemoryJobRepository();
    const input = makeJobInput();
    repo.enqueue(input, now);

    // First worker claims with 30s lease
    repo.claim(["process-payment"], "worker-1", leaseDurationMs, now);

    // Time passes beyond lease expiry
    const afterExpiry = (now + leaseDurationMs + 1) as Instant;
    const result = repo.claim(["process-payment"], "worker-2", leaseDurationMs, afterExpiry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(1);
    expect(result.value[0]!.leaseOwner).toBe("worker-2");
    expect(result.value[0]!.attemptCount).toBe(2);
  });

  it("completes a leased job", () => {
    const repo = new InMemoryJobRepository();
    const input = makeJobInput();
    repo.enqueue(input, now);
    repo.claim(["process-payment"], "worker-1", leaseDurationMs, now);

    const result = repo.complete(input.id, "worker-1", later);
    expect(result.ok).toBe(true);

    const job = repo.getJob(input.id);
    expect(job?.status).toBe("completed");
    expect(job?.completedAt).toBe(later);
  });

  it("cannot complete a job owned by another worker", () => {
    const repo = new InMemoryJobRepository();
    const input = makeJobInput();
    repo.enqueue(input, now);
    repo.claim(["process-payment"], "worker-1", leaseDurationMs, now);

    const result = repo.complete(input.id, "worker-2", later);
    expect(result.ok).toBe(false);
  });

  it("renews lease for the owning worker", () => {
    const repo = new InMemoryJobRepository();
    const input = makeJobInput();
    repo.enqueue(input, now);
    repo.claim(["process-payment"], "worker-1", leaseDurationMs, now);

    const result = repo.renewLease(input.id, "worker-1", leaseDurationMs, later);
    expect(result.ok).toBe(true);

    const job = repo.getJob(input.id);
    expect(job?.leaseExpiresAt).toBe(later + leaseDurationMs);
  });

  it("cannot renew lease for non-owner", () => {
    const repo = new InMemoryJobRepository();
    const input = makeJobInput();
    repo.enqueue(input, now);
    repo.claim(["process-payment"], "worker-1", leaseDurationMs, now);

    const result = repo.renewLease(input.id, "worker-2", leaseDurationMs, later);
    expect(result.ok).toBe(false);
  });

  it("fails a job with exponential backoff", () => {
    const repo = new InMemoryJobRepository();
    const input = makeJobInput({ maxAttempts: 3 });
    repo.enqueue(input, now);
    repo.claim(["process-payment"], "worker-1", leaseDurationMs, now);

    const baseDelay = 1000;
    // attemptCount is 1 after claim, backoff = 1000 * 2^0 = 1000
    const result = repo.fail(input.id, "worker-1", "TimeoutError", "timed out", baseDelay, later);
    expect(result.ok).toBe(true);

    const job = repo.getJob(input.id);
    expect(job?.status).toBe("available");
    expect(job?.lastErrorClass).toBe("TimeoutError");
    expect(job?.availableAt).toBe(later + 1000);
    expect(job?.leaseOwner).toBeUndefined();
  });

  it("moves job to dead_letter after max attempts exhausted (poison job)", () => {
    const repo = new InMemoryJobRepository();
    const input = makeJobInput({ maxAttempts: 2 });
    repo.enqueue(input, now);

    // First attempt
    repo.claim(["process-payment"], "worker-1", leaseDurationMs, now);
    repo.fail(input.id, "worker-1", "Error", "fail", 1000, later);

    // Job is available again after backoff
    const afterBackoff = (later + 1000) as Instant;
    repo.claim(["process-payment"], "worker-2", leaseDurationMs, afterBackoff);

    // Second attempt fails - should dead-letter (attemptCount=2, maxAttempts=2)
    const failTime = (afterBackoff + 5000) as Instant;
    const result = repo.fail(input.id, "worker-2", "Error", "fail again", 1000, failTime);
    expect(result.ok).toBe(true);

    const job = repo.getJob(input.id);
    expect(job?.status).toBe("dead_letter");
    expect(job?.lastErrorClass).toBe("Error");
  });

  it("explicitly dead-letters a job", () => {
    const repo = new InMemoryJobRepository();
    const input = makeJobInput();
    repo.enqueue(input, now);
    repo.claim(["process-payment"], "worker-1", leaseDurationMs, now);

    const result = repo.deadLetter(input.id, "worker-1", "unprocessable payload");
    expect(result.ok).toBe(true);

    const job = repo.getJob(input.id);
    expect(job?.status).toBe("dead_letter");
  });

  it("cannot dead-letter a job owned by another worker", () => {
    const repo = new InMemoryJobRepository();
    const input = makeJobInput();
    repo.enqueue(input, now);
    repo.claim(["process-payment"], "worker-1", leaseDurationMs, now);

    const result = repo.deadLetter(input.id, "worker-2", "reason");
    expect(result.ok).toBe(false);
  });

  it("exponential backoff increases with each attempt", () => {
    const repo = new InMemoryJobRepository();
    const input = makeJobInput({ maxAttempts: 5 });
    repo.enqueue(input, now);
    const baseDelay = 1000;

    // Attempt 1: claim + fail, backoff = 1000 * 2^0 = 1000
    repo.claim(["process-payment"], "worker-1", leaseDurationMs, now);
    repo.fail(input.id, "worker-1", "Error", "fail", baseDelay, now);
    let job = repo.getJob(input.id);
    expect(job?.availableAt).toBe(now + 1000);

    // Attempt 2: claim + fail, backoff = 1000 * 2^1 = 2000
    const t2 = (now + 1000) as Instant;
    repo.claim(["process-payment"], "worker-1", leaseDurationMs, t2);
    repo.fail(input.id, "worker-1", "Error", "fail", baseDelay, t2);
    job = repo.getJob(input.id);
    expect(job?.availableAt).toBe(t2 + 2000);

    // Attempt 3: claim + fail, backoff = 1000 * 2^2 = 4000
    const t3 = (t2 + 2000) as Instant;
    repo.claim(["process-payment"], "worker-1", leaseDurationMs, t3);
    repo.fail(input.id, "worker-1", "Error", "fail", baseDelay, t3);
    job = repo.getJob(input.id);
    expect(job?.availableAt).toBe(t3 + 4000);
  });
});

describe("InMemoryJobRepository - correlation and edge cases", () => {
  const now = 1_700_000_000_000 as Instant;
  const leaseDurationMs = 30_000;

  it("preserves correlationId through claim and complete", () => {
    const repo = new InMemoryJobRepository();
    const corrId = idGen.generate("correlation");
    const input = makeJobInput({ correlationId: corrId });
    repo.enqueue(input, now);

    const claimResult = repo.claim(["process-payment"], "worker-1", leaseDurationMs, now);
    expect(claimResult.ok).toBe(true);
    if (!claimResult.ok) return;
    expect(claimResult.value[0]!.correlationId).toBe(corrId);
  });

  it("claim does not return completed jobs even after lease would have expired", () => {
    const repo = new InMemoryJobRepository();
    const input = makeJobInput();
    repo.enqueue(input, now);
    repo.claim(["process-payment"], "worker-1", leaseDurationMs, now);
    repo.complete(input.id, "worker-1", now);

    const afterExpiry = (now + leaseDurationMs + 1) as Instant;
    const result = repo.claim(["process-payment"], "worker-2", leaseDurationMs, afterExpiry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });

  it("claim does not return dead-lettered jobs even after lease would have expired", () => {
    const repo = new InMemoryJobRepository();
    const input = makeJobInput();
    repo.enqueue(input, now);
    repo.claim(["process-payment"], "worker-1", leaseDurationMs, now);
    repo.deadLetter(input.id, "worker-1", "bad payload");

    const afterExpiry = (now + leaseDurationMs + 1) as Instant;
    const result = repo.claim(["process-payment"], "worker-2", leaseDurationMs, afterExpiry);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value).toHaveLength(0);
  });
});
