import { describe, expect, it } from "vitest";
import { decodeAccessTokenClaims } from "./access-token-claims.js";

function fakeJwt(payload: Record<string, unknown>): string {
  const base64url = (obj: Record<string, unknown>) =>
    Buffer.from(JSON.stringify(obj)).toString("base64url");
  const header = base64url({ alg: "RS256", typ: "JWT" });
  const body = base64url(payload);
  return `${header}.${body}.fake-signature`;
}

describe("decodeAccessTokenClaims", () => {
  it("decodes real merchant-scoped claims", () => {
    const token = fakeJwt({
      "https://counter.dev/actor_kind": "merchant_user",
      "https://counter.dev/environment": "test",
      "https://counter.dev/scope": { kind: "merchant", merchantId: "ctr_merchant_abc123" },
      "https://counter.dev/roles": ["merchant.owner"],
      "https://counter.dev/assurance": "session",
      sub: "google-oauth2|123",
    });

    const claims = decodeAccessTokenClaims(token);

    expect(claims?.actorKind).toBe("merchant_user");
    expect(claims?.scope).toEqual({ kind: "merchant", merchantId: "ctr_merchant_abc123" });
    expect(claims?.roles).toEqual(["merchant.owner"]);
    expect(claims?.assurance).toBe("session");
  });

  it("decodes wallet-scoped claims equally well", () => {
    const token = fakeJwt({
      "https://counter.dev/actor_kind": "wallet_user",
      "https://counter.dev/scope": { kind: "wallet", walletId: "ctr_wallet_xyz789" },
    });

    const claims = decodeAccessTokenClaims(token);

    expect(claims?.actorKind).toBe("wallet_user");
    expect(claims?.scope).toEqual({ kind: "wallet", walletId: "ctr_wallet_xyz789" });
  });

  it("returns undefined for a malformed token", () => {
    expect(decodeAccessTokenClaims("not-a-jwt")).toBeUndefined();
    expect(decodeAccessTokenClaims("")).toBeUndefined();
    expect(decodeAccessTokenClaims("a.b.c")).toBeUndefined();
  });

  it("returns claims with undefined scope for a claims-less token (e.g. a brand-new session)", () => {
    const token = fakeJwt({ sub: "google-oauth2|999" });

    const claims = decodeAccessTokenClaims(token);

    expect(claims?.scope).toBeUndefined();
    expect(claims?.actorKind).toBeUndefined();
  });
});
