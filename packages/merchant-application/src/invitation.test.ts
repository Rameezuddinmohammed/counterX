import { describe, expect, it } from "vitest";
import * as fc from "fast-check";
import type { Instant, CounterId } from "@counter/domain";
import {
  createInvitation,
  acceptInvitation,
  revokeInvitation,
  isInvitationValid,
} from "./index.js";
import type { AllowlistInvitation } from "./index.js";

// --- Test Helpers ---

const NOW = 1_700_000_000_000 as Instant;
const LATER = 1_700_001_000_000 as Instant;
const MUCH_LATER = 1_700_100_000_000 as Instant;
const OPERATOR_ID = "ctr_operator_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"operator">;
const MERCHANT_USER_ID = "ctr_merchant-user_AAAAAAAAAAAAAAAAAAAAAA" as CounterId<"merchant-user">;

function makeValidInvitationInput() {
  return {
    invitationId: "inv_001",
    merchantLegalEntity: "Test Corp Ltd.",
    targetEmail: "merchant@example.com",
    invitedBy: OPERATOR_ID,
    issuedAt: NOW,
    expiresAt: MUCH_LATER,
  };
}

function createPendingInvitation(): AllowlistInvitation {
  const result = createInvitation(makeValidInvitationInput());
  if (!result.ok) throw new Error(`Failed to create invitation: ${result.error.message}`);
  return result.value;
}

// --- Tests ---

describe("invitation negative tests", () => {
  describe("valid invitation creation", () => {
    it("succeeds with valid inputs", () => {
      const result = createInvitation(makeValidInvitationInput());
      expect(result.ok).toBe(true);
      if (result.ok) {
        expect(result.value.status).toBe("pending");
        expect(result.value.merchantLegalEntity).toBe("Test Corp Ltd.");
        expect(result.value.targetEmail).toBe("merchant@example.com");
        expect(result.value.invitedBy).toBe(OPERATOR_ID);
        expect(Object.isFrozen(result.value)).toBe(true);
      }
    });
  });

  describe("expired invitation cannot be accepted", () => {
    it("rejects acceptance when now >= expiresAt", () => {
      const invitation = createPendingInvitation();
      const afterExpiry = (MUCH_LATER + 1_000) as Instant;
      const result = acceptInvitation(invitation, MERCHANT_USER_ID, afterExpiry);
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("OUT_OF_RANGE");
      }
    });

    it("rejects acceptance when now exactly equals expiresAt", () => {
      const invitation = createPendingInvitation();
      const result = acceptInvitation(invitation, MERCHANT_USER_ID, MUCH_LATER);
      expect(result.ok).toBe(false);
    });
  });

  describe("revoked invitation cannot be accepted", () => {
    it("rejects acceptance of a revoked invitation", () => {
      const invitation = createPendingInvitation();
      const revokeResult = revokeInvitation(invitation, LATER);
      expect(revokeResult.ok).toBe(true);
      if (!revokeResult.ok) return;

      const revokedInvitation = revokeResult.value;
      expect(revokedInvitation.status).toBe("revoked");

      const acceptResult = acceptInvitation(revokedInvitation, MERCHANT_USER_ID, LATER);
      expect(acceptResult.ok).toBe(false);
      if (!acceptResult.ok) {
        expect(acceptResult.error.code).toBe("CONFLICT");
      }
    });
  });

  describe("double-acceptance", () => {
    it("already accepted invitation cannot be accepted again", () => {
      const invitation = createPendingInvitation();
      const firstAccept = acceptInvitation(invitation, MERCHANT_USER_ID, LATER);
      expect(firstAccept.ok).toBe(true);
      if (!firstAccept.ok) return;

      const acceptedInvitation = firstAccept.value;
      expect(acceptedInvitation.status).toBe("accepted");

      const secondAccept = acceptInvitation(acceptedInvitation, MERCHANT_USER_ID, LATER);
      expect(secondAccept.ok).toBe(false);
      if (!secondAccept.ok) {
        expect(secondAccept.error.code).toBe("CONFLICT");
      }
    });
  });

  describe("empty legal entity name rejected", () => {
    it("rejects empty string", () => {
      const result = createInvitation({
        ...makeValidInvitationInput(),
        merchantLegalEntity: "",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_FORMAT");
      }
    });

    it("rejects whitespace-only string", () => {
      const result = createInvitation({
        ...makeValidInvitationInput(),
        merchantLegalEntity: "   ",
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("empty target email rejected", () => {
    it("rejects empty string", () => {
      const result = createInvitation({
        ...makeValidInvitationInput(),
        targetEmail: "",
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("INVALID_FORMAT");
      }
    });

    it("rejects whitespace-only string", () => {
      const result = createInvitation({
        ...makeValidInvitationInput(),
        targetEmail: "   ",
      });
      expect(result.ok).toBe(false);
    });
  });

  describe("expiresAt <= issuedAt rejected", () => {
    it("rejects expiresAt == issuedAt", () => {
      const result = createInvitation({
        ...makeValidInvitationInput(),
        issuedAt: NOW,
        expiresAt: NOW,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("OUT_OF_RANGE");
      }
    });

    it("rejects expiresAt < issuedAt", () => {
      const result = createInvitation({
        ...makeValidInvitationInput(),
        issuedAt: LATER,
        expiresAt: NOW,
      });
      expect(result.ok).toBe(false);
      if (!result.ok) {
        expect(result.error.code).toBe("OUT_OF_RANGE");
      }
    });
  });

  describe("revoking non-pending invitation", () => {
    it("cannot revoke an already accepted invitation", () => {
      const invitation = createPendingInvitation();
      const accepted = acceptInvitation(invitation, MERCHANT_USER_ID, LATER);
      expect(accepted.ok).toBe(true);
      if (!accepted.ok) return;

      const revokeResult = revokeInvitation(accepted.value, LATER);
      expect(revokeResult.ok).toBe(false);
      if (!revokeResult.ok) {
        expect(revokeResult.error.code).toBe("CONFLICT");
      }
    });
  });

  describe("property-based tests", () => {
    it("property: any invitation with status != pending or now >= expiresAt is invalid", () => {
      fc.assert(
        fc.property(
          fc.constantFrom("accepted", "expired", "revoked", "pending"),
          fc.integer({ min: 1_600_000_000_000, max: 1_800_000_000_000 }),
          fc.integer({ min: 1_600_000_000_000, max: 1_800_000_000_000 }),
          (status, nowMs, expiresAtMs) => {
            const invitation: AllowlistInvitation = Object.freeze({
              invitationId: "inv_prop_test",
              merchantLegalEntity: "Prop Corp",
              targetEmail: "prop@test.com",
              invitedBy: OPERATOR_ID,
              issuedAt: 1_600_000_000_000 as Instant,
              expiresAt: expiresAtMs as Instant,
              status: status as AllowlistInvitation["status"],
            });

            const now = nowMs as Instant;
            const valid = isInvitationValid(invitation, now);

            if (status !== "pending") {
              expect(valid).toBe(false);
            }
            if (now >= expiresAtMs) {
              expect(valid).toBe(false);
            }
            if (status === "pending" && now < expiresAtMs) {
              expect(valid).toBe(true);
            }
          },
        ),
        { numRuns: 300 },
      );
    });
  });
});
