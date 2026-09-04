/**
 * Regression guard for the Phase 1 blocker that cost two sessions: the
 * step-up token produced by mfa.challengeWithPopup() lives in
 * session.accessTokens[], NOT in session.tokenSet, and auth0.getAccessToken()
 * returns the latter. See step-up-token.ts's header for the full mechanism.
 *
 * The point of these tests is that the popup token WINS over the session
 * token whenever one is present and unexpired — if someone "simplifies" this
 * back to a plain getAccessToken() call, the first case here fails.
 */
import { describe, expect, it, vi } from "vitest";
import type { SessionData } from "@auth0/nextjs-auth0/types";

const getAccessToken = vi.fn<() => Promise<{ token: string }>>();
vi.mock("./auth0", () => ({
  auth0: { getAccessToken: async (): Promise<{ token: string }> => getAccessToken() },
}));

const { getStepUpAccessToken, API_AUDIENCE } = await import("./step-up-token.js");

/** A JWT whose payload carries just the assurance claim we read back. */
function jwtWithAssurance(assurance: string): string {
  const payload = Buffer.from(
    JSON.stringify({ "https://counter.dev/assurance": assurance }),
    "utf8",
  ).toString("base64url");
  return `header.${payload}.signature`;
}

function sessionWith(accessTokens: SessionData["accessTokens"]): SessionData {
  return {
    user: { sub: "auth0|test" },
    tokenSet: { accessToken: jwtWithAssurance("session"), idToken: undefined },
    ...(accessTokens === undefined ? {} : { accessTokens }),
    internal: { sid: "sid", createdAt: 0 },
  } as unknown as SessionData;
}

const future = Math.floor(Date.now() / 1000) + 3600;
const past = Math.floor(Date.now() / 1000) - 3600;

describe("getStepUpAccessToken", () => {
  it("prefers the step-up popup's token over the login-session token", async () => {
    getAccessToken.mockResolvedValue({ token: jwtWithAssurance("session") });
    const session = sessionWith([
      {
        accessToken: jwtWithAssurance("step_up"),
        audience: API_AUDIENCE,
        expiresAt: future,
      },
    ]);

    const result = await getStepUpAccessToken(session);

    expect(result.source).toBe("step-up-popup");
    expect(result.assurance).toBe("step_up");
    expect(getAccessToken).not.toHaveBeenCalled();
  });

  it("falls back to the login-session token when no popup token exists", async () => {
    getAccessToken.mockResolvedValue({ token: jwtWithAssurance("session") });

    const result = await getStepUpAccessToken(sessionWith(undefined));

    expect(result.source).toBe("login-session");
    expect(result.assurance).toBe("session");
  });

  it("ignores an expired popup token", async () => {
    getAccessToken.mockResolvedValue({ token: jwtWithAssurance("session") });
    const session = sessionWith([
      { accessToken: jwtWithAssurance("step_up"), audience: API_AUDIENCE, expiresAt: past },
    ]);

    const result = await getStepUpAccessToken(session);

    expect(result.source).toBe("login-session");
  });

  it("ignores a popup token minted for a different audience", async () => {
    getAccessToken.mockResolvedValue({ token: jwtWithAssurance("session") });
    const session = sessionWith([
      {
        accessToken: jwtWithAssurance("step_up"),
        audience: "https://some-other-api.example.com",
        expiresAt: future,
      },
    ]);

    const result = await getStepUpAccessToken(session);

    expect(result.source).toBe("login-session");
  });
});
