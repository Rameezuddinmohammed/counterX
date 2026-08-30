/**
 * Requirement traceability for pilot certification.
 *
 * Maps each PILOT.md released operation candidate (section 3) to its test
 * evidence, enabling certification that every requirement has been exercised
 * and evidenced by the test suite.
 */

// ─── Requirement Link ───────────────────────────────────────────────────────

export type RequirementLinkStatus = "covered" | "partial" | "missing";

export interface RequirementLink {
  readonly requirementId: string;
  readonly pilotMdSection: string;
  readonly testScenarioId: string;
  readonly evidenceIds: readonly string[];
  readonly status: RequirementLinkStatus;
}

// ─── PILOT.md Section 3 Released Operation Candidates ───────────────────────

/**
 * All 14 released operation candidates from PILOT.md section 3.
 * No operation is Released until its evidence passes.
 */
export const PILOT_REQUIREMENTS: readonly {
  readonly id: string;
  readonly description: string;
  readonly section: string;
}[] = Object.freeze([
  {
    id: "REQ-001",
    description: "merchant discovery/capability retrieval",
    section: "3.1",
  },
  {
    id: "REQ-002",
    description: "product search/detail",
    section: "3.2",
  },
  {
    id: "REQ-003",
    description: "current price and availability",
    section: "3.3",
  },
  {
    id: "REQ-004",
    description:
      "immutable quote with tax/shipping/fees if applicable, expiry, freshness, and digest",
    section: "3.4",
  },
  {
    id: "REQ-005",
    description: "agent registration and key status",
    section: "3.5",
  },
  {
    id: "REQ-006",
    description: "Wallet policy and mandate creation outside MCP/model access",
    section: "3.6",
  },
  {
    id: "REQ-007",
    description: "purchase-intent creation and approval when required",
    section: "3.7",
  },
  {
    id: "REQ-008",
    description: "policy evaluation and denial/review/allow result",
    section: "3.8",
  },
  {
    id: "REQ-009",
    description:
      "Counter test-provider payment and authoritative test status for unattended bounded scenarios",
    section: "3.9",
  },
  {
    id: "REQ-010",
    description:
      "Razorpay Standard Checkout test instruction, PAYMENT_ACTION_REQUIRED, and authoritative provider status",
    section: "3.10",
  },
  {
    id: "REQ-011",
    description: "Shopify test order creation/status",
    section: "3.11",
  },
  {
    id: "REQ-012",
    description:
      "test order cancellation and full refund where current state/provider profile permits",
    section: "3.12",
  },
  {
    id: "REQ-013",
    description: "reconciliation, findings, signed receipt, and receipt verification",
    section: "3.13",
  },
  {
    id: "REQ-014",
    description: "merchant/Wallet/agent suspension, revocation, and offboarding",
    section: "3.14",
  },
]);

// ─── Traceability Matrix ────────────────────────────────────────────────────

export interface TraceabilityMatrix {
  readonly links: readonly RequirementLink[];
  readonly totalRequirements: number;
  readonly coveredCount: number;
  readonly partialCount: number;
  readonly missingCount: number;
}

// ─── Traceability Validation ────────────────────────────────────────────────

export interface TraceabilityValidation {
  readonly valid: boolean;
  readonly missingRequirements: readonly string[];
  readonly partialRequirements: readonly string[];
  readonly coveragePercentage: number;
}

// ─── Certification Result (for building the matrix) ─────────────────────────

export interface CertificationScenarioResult {
  readonly scenarioId: string;
  readonly requirementIds: readonly string[];
  readonly passed: boolean;
  readonly evidenceIds: readonly string[];
}

// ─── Build Traceability Matrix ──────────────────────────────────────────────

/**
 * Builds a traceability matrix mapping each PILOT.md requirement to its test
 * evidence from certification results.
 *
 * Each requirement is classified as:
 * - covered: at least one passing scenario with evidence references it
 * - partial: a scenario references it but did not pass
 * - missing: no scenario references this requirement
 */
export function buildTraceabilityMatrix(
  certificationResults: readonly CertificationScenarioResult[],
  requirements: readonly {
    readonly id: string;
    readonly description: string;
    readonly section: string;
  }[] = PILOT_REQUIREMENTS,
): TraceabilityMatrix {
  const links: RequirementLink[] = [];
  let coveredCount = 0;
  let partialCount = 0;
  let missingCount = 0;

  for (const req of requirements) {
    // Find all scenarios that reference this requirement
    const matchingScenarios = certificationResults.filter((r) => r.requirementIds.includes(req.id));

    if (matchingScenarios.length === 0) {
      links.push(
        Object.freeze({
          requirementId: req.id,
          pilotMdSection: req.section,
          testScenarioId: "",
          evidenceIds: Object.freeze([]),
          status: "missing" as const,
        }),
      );
      missingCount++;
    } else {
      // Check if at least one passing scenario covers this requirement
      const passingScenarios = matchingScenarios.filter((s) => s.passed);
      const allEvidenceIds = matchingScenarios.flatMap((s) => s.evidenceIds);

      if (passingScenarios.length > 0) {
        links.push(
          Object.freeze({
            requirementId: req.id,
            pilotMdSection: req.section,
            testScenarioId: passingScenarios[0]!.scenarioId,
            evidenceIds: Object.freeze([...new Set(allEvidenceIds)]),
            status: "covered" as const,
          }),
        );
        coveredCount++;
      } else {
        links.push(
          Object.freeze({
            requirementId: req.id,
            pilotMdSection: req.section,
            testScenarioId: matchingScenarios[0]!.scenarioId,
            evidenceIds: Object.freeze([...new Set(allEvidenceIds)]),
            status: "partial" as const,
          }),
        );
        partialCount++;
      }
    }
  }

  return Object.freeze({
    links: Object.freeze(links),
    totalRequirements: requirements.length,
    coveredCount,
    partialCount,
    missingCount,
  });
}

// ─── Validate Traceability ──────────────────────────────────────────────────

/**
 * Validates that a traceability matrix has no missing requirements.
 * Returns a TraceabilityValidation indicating overall coverage health.
 */
export function validateTraceability(matrix: TraceabilityMatrix): TraceabilityValidation {
  const missingRequirements = matrix.links
    .filter((l) => l.status === "missing")
    .map((l) => l.requirementId);

  const partialRequirements = matrix.links
    .filter((l) => l.status === "partial")
    .map((l) => l.requirementId);

  const coveragePercentage =
    matrix.totalRequirements > 0 ? (matrix.coveredCount / matrix.totalRequirements) * 100 : 0;

  return Object.freeze({
    valid: missingRequirements.length === 0 && partialRequirements.length === 0,
    missingRequirements: Object.freeze([...missingRequirements]),
    partialRequirements: Object.freeze([...partialRequirements]),
    coveragePercentage,
  });
}
