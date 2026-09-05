import { describe, expect, it } from "vitest";
import { jwtVerify } from "jose";
import { RUNTIME_TOKEN_TEST_KID, RUNTIME_TOKEN_TEST_PUBLIC_KEY_PEM } from "@counter/domain";
import { WalletUserProvisioner } from "./wallet-user-store.js";
import {
  resolveRuntimeTokenSigner,
  requireRuntimeTokenSigner,
} from "./runtime-token-signer-env.js";

/**
 * Unit coverage for WalletUserProvisioner.mintRuntimeCredential() — the one
 * method that doesn't touch the database, so it doesn't need the
 * DATABASE_URL-gated integration test's real Supabase connection.
 */
describe("WalletUserProvisioner.mintRuntimeCredential", () => {
  it("throws a clear error when no runtime credential is configured", async () => {
    const provisioner = new WalletUserProvisioner({} as never, "test");
    await expect(
      provisioner.mintRuntimeCredential("ctr_wallet_test", "ctr_agent_test"),
    ).rejects.toThrow("No runtime credential is configured for this deployment");
  });

  it("self-signs a JWT wallet-scoped to the real wallet, independently verifiable against the public key", async () => {
    const signer = requireRuntimeTokenSigner({}, true); // falls back to the public test fixture
    const provisioner = new WalletUserProvisioner({} as never, "test", {
      signerKid: signer.kid,
      signerPrivateKeyPem: signer.privateKeyPem,
      isFixtureSigner: signer.isFixture,
      issuer: "https://runtime.counter.dev/",
      runtimeUrl: "https://counter-agent-runtime.fly.dev",
    });

    const result = await provisioner.mintRuntimeCredential(
      "ctr_wallet_abc123",
      "ctr_agent_xyz789",
    );

    expect(result.runtimeUrl).toBe("https://counter-agent-runtime.fly.dev");
    expect(new Date(result.expiresAt).getTime()).toBeGreaterThan(Date.now());

    const { importSPKI } = await import("jose");
    const publicKey = await importSPKI(RUNTIME_TOKEN_TEST_PUBLIC_KEY_PEM, "RS256");
    const { payload, protectedHeader } = await jwtVerify(result.runtimeAuthToken, publicKey, {
      issuer: "https://runtime.counter.dev/",
      audience: "https://api.counter.dev",
    });

    expect(protectedHeader.kid).toBe(RUNTIME_TOKEN_TEST_KID);
    expect(payload.sub).toBe("ctr_wallet_abc123");
    expect(payload["agent_id"]).toBe("ctr_agent_xyz789");
    expect(payload["https://counter.dev/actor_kind"]).toBe("service");
    expect(payload["https://counter.dev/scope"]).toEqual({
      kind: "wallet",
      walletId: "ctr_wallet_abc123",
    });
    expect(payload["https://counter.dev/roles"]).toEqual(["service.identity"]);
  });

  it("two different wallets get tokens scoped to their own, distinct wallet id", async () => {
    const signer = requireRuntimeTokenSigner({}, true);
    const provisioner = new WalletUserProvisioner({} as never, "test", {
      signerKid: signer.kid,
      signerPrivateKeyPem: signer.privateKeyPem,
      isFixtureSigner: signer.isFixture,
      issuer: "https://runtime.counter.dev/",
      runtimeUrl: "https://counter-agent-runtime.fly.dev",
    });

    const first = await provisioner.mintRuntimeCredential("ctr_wallet_one", "ctr_agent_one");
    const second = await provisioner.mintRuntimeCredential("ctr_wallet_two", "ctr_agent_two");

    const publicKey = await (
      await import("jose")
    ).importSPKI(RUNTIME_TOKEN_TEST_PUBLIC_KEY_PEM, "RS256");
    const firstPayload = (
      await jwtVerify(first.runtimeAuthToken, publicKey, {
        issuer: "https://runtime.counter.dev/",
        audience: "https://api.counter.dev",
      })
    ).payload;
    const secondPayload = (
      await jwtVerify(second.runtimeAuthToken, publicKey, {
        issuer: "https://runtime.counter.dev/",
        audience: "https://api.counter.dev",
      })
    ).payload;

    expect(firstPayload["https://counter.dev/scope"]).toEqual({
      kind: "wallet",
      walletId: "ctr_wallet_one",
    });
    expect(secondPayload["https://counter.dev/scope"]).toEqual({
      kind: "wallet",
      walletId: "ctr_wallet_two",
    });
  });
});

describe("resolveRuntimeTokenSigner", () => {
  it("returns null when the env vars are absent", () => {
    expect(resolveRuntimeTokenSigner({})).toBeNull();
  });

  it("resolves a real signer from valid env vars", () => {
    const privateKeyBase64 = Buffer.from("-----BEGIN PRIVATE KEY-----\nabc\n-----END PRIVATE KEY-----").toString(
      "base64",
    );
    const resolved = resolveRuntimeTokenSigner({
      RUNTIME_TOKEN_SIGNER_KID: "real-kid",
      RUNTIME_TOKEN_SIGNER_PRIVATE_KEY_BASE64: privateKeyBase64,
    });
    expect(resolved).not.toBeNull();
    expect(resolved?.kid).toBe("real-kid");
    expect(resolved?.privateKeyPem).toContain("BEGIN PRIVATE KEY");
  });
});

describe("requireRuntimeTokenSigner", () => {
  it("throws in a production-like environment with no key configured", () => {
    expect(() => requireRuntimeTokenSigner({}, false)).toThrow(
      /Refusing to start in a production-like environment/,
    );
  });

  it("falls back to the public test fixture outside production", () => {
    const signer = requireRuntimeTokenSigner({}, true);
    expect(signer.isFixture).toBe(true);
    expect(signer.kid).toBe(RUNTIME_TOKEN_TEST_KID);
  });
});
