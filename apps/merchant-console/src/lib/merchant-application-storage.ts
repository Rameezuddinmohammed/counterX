/**
 * Client-side convenience cache for the self-serve onboarding wizard's
 * merchantId — NOT the source of truth (control-plane-api's
 * merchant.onboarding_applications table is), just a way for the wizard to
 * resume across page loads and reloads within the SAME browser without
 * re-deriving the merchant id from a network call every time.
 *
 * KNOWN LIMITATION, disclosed rather than papered over: this can't yet be
 * replaced with "ask the server which application belongs to my session",
 * because doing so needs either a real merchant-scoped JWT (which a
 * freshly-provisioned session doesn't have — no Auth0 Post-Login Action
 * stamps merchant_user claims yet, see merchant-application-routes.ts's
 * header) or a new lookup-by-subject route this pass didn't build. A
 * different browser/device, or a cleared localStorage, means the wizard
 * shows "Request Access" again even though a merchant application already
 * exists for that Auth0 subject — provisionForAuth0Subject is idempotent
 * server-side, so clicking the button again is harmless (returns the SAME
 * merchant, 200 not 201), just not a seamless resume.
 */

const STORAGE_KEY = "counter.merchantConsole.merchantApplicationId";

export function getStoredMerchantId(): string | undefined {
  if (typeof window === "undefined") return undefined;
  try {
    return window.localStorage.getItem(STORAGE_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

export function setStoredMerchantId(merchantId: string): void {
  if (typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_KEY, merchantId);
  } catch {
    // Best-effort only — a private browsing session or blocked storage
    // simply loses resume-across-reload convenience, nothing breaks.
  }
}
