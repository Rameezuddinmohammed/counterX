/**
 * Auth0 Post-Login Action — "Counter Console: provision merchant/wallet + stamp session"
 * Action id b61c2ea0-054f-45f7-81a4-c99a12b2eba0, tenant dev-jzw3etjxnn3svs56.
 *
 * THIS FILE IS A CHECKED-IN COPY OF LIVE AUTH0 CONFIGURATION. Auth0 is the
 * system of record; this copy exists because the Action is invisible to git
 * and its absence has already caused real confusion (two internal notes
 * disagreed about whether merchant claims were being stamped at all, and the
 * answer decided whether the merchant wizard was considered blocked). If you
 * change the Action in the dashboard, update this file in the same change.
 *
 * Runs for logins to the shared "Counter Console" app (client_id
 * MjT42KkgioYeyoM5EqgjCk8Mbz5atj7n), used by BOTH merchant-console and
 * wallet-console. Those two apps request different OAuth scopes
 * (merchant:read/merchant:write vs wallet:read/wallet:write), which is the
 * only signal available to tell which flow a login belongs to, since both
 * share one Auth0 application registration.
 *
 * For a wallet:read login it calls POST /control/v1/wallet-users/provision
 * and stamps wallet_user claims; for a merchant:read login it calls
 * POST /control/v1/merchant-applications/provision and stamps merchant_user
 * claims. Both routes are idempotent, so a returning user gets their
 * existing wallet/merchant, and running them twice in one login is safe —
 * which matters, because a step-up halts and re-runs this whole action.
 *
 * ORDERING (2026-09-05 fix — this is the important part):
 * Identity is provisioned and stamped BEFORE any step-up is triggered.
 *
 * The previous version did the opposite: it triggered the MFA
 * challenge/enrolment first and returned, relying on Auth0 re-running the
 * action afterwards to stamp claims on the second pass. That bet failed in
 * production. A first-time merchant login with acr_values requesting
 * multi-factor enrolled and verified a real TOTP factor (Auth0 logs:
 * gd_auth_succeed, performed_amr ["mfa"]) and the login COMPLETED — but the
 * second pass still evaluated `alreadyDidMfa` as false, took the same early
 * return, and stamped nothing. The session came back with no scope claim at
 * all and the console reported "Your session isn't scoped to a merchant
 * account": the user lost their identity entirely, which is far worse than
 * being refused on a write.
 *
 * Stamping first makes that failure mode impossible. Whether a redundant
 * challenge call is a no-op (execution finishes with these claims applied)
 * or genuinely halts (execution restarts and stamps again), a completed
 * login now always carries identity. The worst remaining outcome is an
 * assurance of "session", which is merely a refused write with an
 * actionable message — never a lost identity.
 *
 * SCOPE SIGNAL: `event.transaction.requested_scopes` is the primary signal,
 * with `event.request.query.scope` as a fallback, because the transaction
 * view is not guaranteed to survive an MFA interruption intact.
 *
 * ASSURANCE: stamps the REAL per-transaction level rather than a hardcoded
 * "session", matching packages/authorization/src/assurance.ts (payment.
 * mandate.manage / identity.agent_key.manage / identity.scope.manage
 * require multi_factor | step_up | service_authenticated). Second-factor
 * method names are matched from an explicit allowlist; deliberately NOT
 * including "email"/"sms"/"federated"/"pwd"/"passkey", any of which can be a
 * PRIMARY login method here and must never be mistaken for a second factor.
 *
 * DIAGNOSTIC CLAIM, temporary: `auth_methods` echoes the method names Auth0
 * reported for this transaction. It exists because the step-up above failed
 * for a reason we could not determine from logs alone — whether
 * event.authentication.methods actually reports the completed TOTP. It
 * describes only the caller's own authentication to the caller's own token.
 * REMOVE once the step-up question is settled.
 *
 * Required Action Secret (set in the dashboard, never committed):
 *   PROVISIONER_CLIENT_SECRET — client secret for YDEVc8MojpkGXTlffzGMOGalxhrdyY8F
 */
const COUNTER_CONSOLE_CLIENT_ID = "MjT42KkgioYeyoM5EqgjCk8Mbz5atj7n";
const PROVISIONER_CLIENT_ID = "YDEVc8MojpkGXTlffzGMOGalxhrdyY8F";
const AUTH0_TOKEN_URL = "https://dev-jzw3etjxnn3svs56.us.auth0.com/oauth/token";
const CONTROL_PLANE_URL = "https://counter-control-plane-api.fly.dev";
const NAMESPACE = "https://counter.dev/";
const MFA_POLICY_ACR = "http://schemas.openid.net/pape/policies/2007/06/multi-factor";

// Names that can ONLY mean a real second factor on this tenant. See the
// header: primary-login method names are deliberately excluded.
const SECOND_FACTOR_METHOD_NAMES = [
  "mfa",
  "otp",
  "totp",
  "push",
  "push-notification",
  "webauthn",
  "webauthn-platform",
  "webauthn-roaming",
  "recovery-code",
];

function authMethodNames(event) {
  const methods = (event.authentication && event.authentication.methods) || [];
  return methods.map((m) => (m && m.name) || "").filter((n) => n.length > 0);
}

function computeAssurance(event) {
  const names = authMethodNames(event);
  return names.some((n) => SECOND_FACTOR_METHOD_NAMES.includes(n)) ? "step_up" : "session";
}

function requestedScopesFor(event) {
  const fromTransaction = (event.transaction && event.transaction.requested_scopes) || [];
  if (fromTransaction.length > 0) {
    return fromTransaction;
  }
  // Fallback: the raw authorize query. Used when an MFA interruption has
  // left the parsed transaction view without its scopes.
  const raw = (event.request && event.request.query && event.request.query.scope) || "";
  return typeof raw === "string" ? raw.split(" ").filter((s) => s.length > 0) : [];
}

exports.onExecutePostLogin = async (event, api) => {
  if (event.client.client_id !== COUNTER_CONSOLE_CLIENT_ID) {
    return;
  }

  const requestedScopes = requestedScopesFor(event);
  const isMerchant = requestedScopes.includes("merchant:read");
  const isWallet = requestedScopes.includes("wallet:read");
  if (!isMerchant && !isWallet) {
    return;
  }

  // ---- 1. Provision + stamp identity. ALWAYS, before any step-up. ----
  const tokenResponse = await fetch(AUTH0_TOKEN_URL, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({
      grant_type: "client_credentials",
      client_id: PROVISIONER_CLIENT_ID,
      client_secret: event.secrets.PROVISIONER_CLIENT_SECRET,
      audience: "https://api.counter.dev",
    }),
  });
  if (!tokenResponse.ok) {
    api.access.deny("Could not authenticate the provisioning service.");
    return;
  }
  const { access_token: provisionerToken } = await tokenResponse.json();

  const provisionPath = isMerchant
    ? "/control/v1/merchant-applications/provision"
    : "/control/v1/wallet-users/provision";
  const provisionResponse = await fetch(`${CONTROL_PLANE_URL}${provisionPath}`, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${provisionerToken}`,
    },
    body: JSON.stringify({ auth0Subject: event.user.user_id }),
  });
  if (!provisionResponse.ok) {
    api.access.deny(
      isMerchant
        ? "Could not provision your merchant account. Please try again."
        : "Could not provision your wallet. Please try again.",
    );
    return;
  }
  const body = await provisionResponse.json();

  const actorKind = isMerchant ? "merchant_user" : "wallet_user";
  const scope = isMerchant
    ? { kind: "merchant", merchantId: body.merchantId }
    : { kind: "wallet", walletId: body.walletId };
  const roles = isMerchant ? ["merchant.owner"] : ["wallet.owner"];
  const assurance = computeAssurance(event);
  const methodNames = authMethodNames(event);

  for (const token of [api.idToken, api.accessToken]) {
    token.setCustomClaim(`${NAMESPACE}actor_kind`, actorKind);
    token.setCustomClaim(`${NAMESPACE}environment`, "test");
    token.setCustomClaim(`${NAMESPACE}scope`, scope);
    token.setCustomClaim(`${NAMESPACE}roles`, roles);
    token.setCustomClaim(`${NAMESPACE}assurance`, assurance);
    token.setCustomClaim(`${NAMESPACE}auth_methods`, methodNames);
  }

  // ---- 2. Only now, ask for a step-up if this transaction wanted one. ----
  // Reaching here means identity is already stamped, so even if this halts
  // and the re-run behaves unexpectedly, the login cannot end up anonymous.
  const acrValues = (event.transaction && event.transaction.acr_values) || [];
  const requestsStepUp = acrValues.includes(MFA_POLICY_ACR);
  if (requestsStepUp && assurance !== "step_up") {
    const enrolledFactors = (event.user && event.user.enrolledFactors) || [];
    if (enrolledFactors.length > 0) {
      api.authentication.challengeWithAny(enrolledFactors.map((f) => ({ type: f.type })));
    } else {
      api.authentication.enrollWithAny([{ type: "otp" }]);
    }
  }
};
