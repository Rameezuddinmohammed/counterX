/**
 * @auth0/nextjs-auth0 v4's session.user is populated from the OIDC userinfo
 * response, not the raw ID token — so custom claims added by a Post-Login
 * Action via api.idToken.setCustomClaim() never appear there. The real
 * claims are in session.tokenSet.idToken, so decode that JWT's payload
 * directly. No signature check needed: the SDK already verified this token
 * during the login token exchange before storing the session.
 *
 * Mirrors apps/onboarding/src/lib/id-token-claims.ts exactly.
 */
export function decodeIdTokenClaims(idToken: string | undefined): Record<string, unknown> {
  if (idToken === undefined) {
    return {};
  }
  const payload = idToken.split(".")[1];
  if (payload === undefined) {
    return {};
  }
  try {
    return JSON.parse(Buffer.from(payload, "base64url").toString("utf8")) as Record<
      string,
      unknown
    >;
  } catch {
    return {};
  }
}
