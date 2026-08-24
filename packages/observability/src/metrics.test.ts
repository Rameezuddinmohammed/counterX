import { describe, expect, it } from "vitest";
import { metrics } from "@opentelemetry/api";
import { createDomainMetrics, METRIC_NAMES } from "./metrics.js";

describe("domain metrics", () => {
  it("creates all metric instruments without error", () => {
    const meter = metrics.getMeter("test-meter");
    const domainMetrics = createDomainMetrics(meter);

    expect(domainMetrics.apiRequestDuration).toBeDefined();
    expect(domainMetrics.jobAge).toBeDefined();
    expect(domainMetrics.jobAttempts).toBeDefined();
    expect(domainMetrics.outboxLag).toBeDefined();
    expect(domainMetrics.policyDecisionTotal).toBeDefined();
    expect(domainMetrics.authorityFailureTotal).toBeDefined();
    expect(domainMetrics.transactionCount).toBeDefined();
    expect(domainMetrics.indeterminateAge).toBeDefined();
    expect(domainMetrics.providerErrorTotal).toBeDefined();
    expect(domainMetrics.reconciliationLag).toBeDefined();
    expect(domainMetrics.findingCount).toBeDefined();
    expect(domainMetrics.receiptSigningFailureTotal).toBeDefined();
  });

  it("records histogram observations without throwing", () => {
    const meter = metrics.getMeter("test-meter-record");
    const domainMetrics = createDomainMetrics(meter);

    expect(() => {
      domainMetrics.apiRequestDuration.record(0.125, {
        "http.route": "/api/v1/transactions",
        "http.request.method": "POST",
        "http.response.status_code": 200,
      });
    }).not.toThrow();

    expect(() => {
      domainMetrics.jobAge.record(15.5);
    }).not.toThrow();

    expect(() => {
      domainMetrics.jobAttempts.record(3);
    }).not.toThrow();
  });

  it("records counter observations without throwing", () => {
    const meter = metrics.getMeter("test-meter-counter");
    const domainMetrics = createDomainMetrics(meter);

    expect(() => {
      domainMetrics.policyDecisionTotal.add(1, {
        "counter.policy.outcome": "approved",
      });
    }).not.toThrow();

    expect(() => {
      domainMetrics.authorityFailureTotal.add(1, {
        "counter.authority.failure_reason": "expired_grant",
      });
    }).not.toThrow();

    expect(() => {
      domainMetrics.providerErrorTotal.add(1, {
        "counter.provider.name": "stripe",
        "counter.error.class": "timeout",
      });
    }).not.toThrow();

    expect(() => {
      domainMetrics.receiptSigningFailureTotal.add(1);
    }).not.toThrow();
  });

  it("records gauge observations without throwing", () => {
    const meter = metrics.getMeter("test-meter-gauge");
    const domainMetrics = createDomainMetrics(meter);

    expect(() => {
      domainMetrics.outboxLag.record(2.5);
    }).not.toThrow();

    expect(() => {
      domainMetrics.transactionCount.record(42, {
        "counter.transaction.state": "pending",
      });
    }).not.toThrow();

    expect(() => {
      domainMetrics.indeterminateAge.record(300);
    }).not.toThrow();

    expect(() => {
      domainMetrics.reconciliationLag.record(60);
    }).not.toThrow();

    expect(() => {
      domainMetrics.findingCount.record(7, {
        "counter.finding.severity": "high",
        "counter.finding.status": "open",
      });
    }).not.toThrow();
  });

  it("defines correct metric names", () => {
    expect(METRIC_NAMES.API_REQUEST_DURATION).toBe("counter.api.request_duration_seconds");
    expect(METRIC_NAMES.JOB_AGE).toBe("counter.job.age_seconds");
    expect(METRIC_NAMES.JOB_ATTEMPTS).toBe("counter.job.attempts");
    expect(METRIC_NAMES.OUTBOX_LAG).toBe("counter.outbox.lag_seconds");
    expect(METRIC_NAMES.POLICY_DECISION_TOTAL).toBe("counter.policy.decision_total");
    expect(METRIC_NAMES.AUTHORITY_FAILURE_TOTAL).toBe("counter.authority.failure_total");
    expect(METRIC_NAMES.TRANSACTION_COUNT).toBe("counter.transaction.count");
    expect(METRIC_NAMES.INDETERMINATE_AGE).toBe("counter.indeterminate.age_seconds");
    expect(METRIC_NAMES.PROVIDER_ERROR_TOTAL).toBe("counter.provider.error_total");
    expect(METRIC_NAMES.RECONCILIATION_LAG).toBe("counter.reconciliation.lag_seconds");
    expect(METRIC_NAMES.FINDING_COUNT).toBe("counter.finding.count");
    expect(METRIC_NAMES.RECEIPT_SIGNING_FAILURE_TOTAL).toBe(
      "counter.receipt.signing_failure_total",
    );
  });
});
