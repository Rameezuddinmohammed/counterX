/**
 * Picks the access token to present to control-plane-api for a route gated by
 * step-up assurance (payment.mandate.manage / identity.agent_key.manage).
 *
 * WHY THIS EXISTS — do not "simplify" this back to auth0.getAccessToken().
 *
 * mfa.challengeWithPopup() (connect-panel.tsx) completes a full authorization
 * code flow in a popup. Its callback does NOT replace the session's primary
 * token. @auth0/nextjs-auth0 v4's mergePopupTokenIntoSession()
 * (dist/utils/session-helpers.js) deliberately appends the elevated token to
 * `session.accessTokens[]`, keyed by audience, and leaves the original
 * login-time `session.tokenSet` untouched — so the user's MRRT tokens and
 * refresh token survive the popup.
 *
 * But the read path never looks there in our configuration. AuthClient's
 * #getTokenSetFromSession (dist/server/auth-client.js) short-circuits:
 *
 *     isAudienceTheGlobalAudience = !audience || audience === (tokenSet.audience
 *                                    ?? authorizationParameters.audience)
 *     isScopeTheGlobalScope       = !scope    || compareScopes(...)
 *     if (both) return tokenSet   // <- top-level, i.e. the login-time token
 *
 * `session.accessTokens[]` is only consulted (via findAccessTokenSet) when the
 * requested audience/scope DIFFER from the global ones. This app's step-up
 * popup uses exactly the global audience and scope (lib/auth0.ts —
 * https://api.counter.dev, "openid profile email wallet:read wallet:write"),
 * which is also what control-plane-api verifies, so the short-circuit always
 * fires and the stale login token is returned. Passing an explicit
 * `{ audience }` to getAccessToken() does not change this: it resolves to the
 * same value the global config already supplies, so the comparison still
 * matches. That was confirmed live — a token logged from that call carried
 * assurance "session" and an `iat` predating the popup, and the flow 403'd.
 *
 * So: read the audience-matched entry out of session.accessTokens[] directly
 * (a documented field on the public SessionData type), and fall back to the
 * ordinary session token when no popup token is present — the route's own
 * server-side assurance check in control-plane-api is what actually enforces
 * step-up, so a fallback here can never grant more authority than the token
 * itself carries.
 */
import type { SessionData } from "@auth0/nextjs-auth0/types";
import { auth0 } from "./auth0";
import { decodeIdTokenClaims } from "./id-token-claims";

/** Must match control-plane-api's AUTH_AUDIENCE and lib/auth0.ts's audience. */
export const API_AUDIENCE = process.env["AUTH0_AUDIENCE"] ?? "https://api.counter.dev";

const NAMESPACE = "https://counter.dev/";

export interface StepUpToken {
  readonly token: string;
  /** Where the token came from — logged so a future 403 is diagnosable. */
  readonly source: "step-up-popup" | "login-session";
  /** The assurance level control-plane-api will read off this token. */
  readonly assurance: string;
}

/**
 * Reads the assurance claim control-plane-api will enforce against
 * (packages/http-api-kit/src/actor-extraction.ts's extractAssurance).
 *
 * decodeIdTokenClaims is a plain JWT-payload decoder — no signature check
 * needed, since the SDK verified these tokens at exchange time before storing
 * them — and it reads an access token's payload just as well as an ID token's.
 * This value is only ever logged, never trusted for an access decision.
 */
function readAssurance(token: string): string {
  const value = decodeIdTokenClaims(token)[`${NAMESPACE}assurance`];
  return typeof value === "string" ? value : "unknown";
}

export async function getStepUpAccessToken(session: SessionData): Promise<StepUpToken> {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const elevated = session.accessTokens?.find(
    (entry) => entry.audience === API_AUDIENCE && entry.expiresAt > nowSeconds,
  );

  if (elevated !== undefined) {
    return {
      token: elevated.accessToken,
      source: "step-up-popup",
      assurance: readAssurance(elevated.accessToken),
    };
  }

  const { token } = await auth0.getAccessToken();
  return { token, source: "login-session", assurance: readAssurance(token) };
}
