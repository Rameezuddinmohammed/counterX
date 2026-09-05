/**
 * Client-side convenience cache for the self-serve onboarding wizard's
 * merchantId — NOT the source of truth (control-plane-api's
 * merchant.onboarding_applications table is), just a way for the wizard to
 * resume across page loads and reloads within the SAME browser without
 * re-deriving the merchant id from a network call every time.
 *
 * NO LONGER the wizard's only source of the merchant id (2026-09-05): the
 * Auth0 Post-Login Action that stamps merchant_user claims is live, so
 * useWizardMerchantId (hooks/use-api.ts) reads the merchant id straight off
 * the signed-in session's access token and treats this cache as a fallback
 * only. That closed a real dead-end where a second device, a fresh browser
 * profile, or cleared site data made every wizard step report "No
 * application found yet" for an account that plainly existed — and where a
 * stale id cached from a previous account silently pointed the wizard at
 * the wrong merchant. The hook also rewrites this cache from the token on
 * every load, so it self-heals rather than persisting a wrong value.
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
