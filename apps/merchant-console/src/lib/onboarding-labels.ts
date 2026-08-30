/**
 * Plain-language labels for the self-serve onboarding wizard — CLAUDE.md
 * requires state to non-technical users in plain language, not raw enum
 * values, so every screen showing a MerchantLifecycleState or
 * FulfillmentCapability goes through here rather than printing the wire
 * value directly.
 */
import type {
  FulfillmentCapability,
  MerchantLifecycleState,
  WizardReadinessCheckKind,
  WizardReadinessCheckStatus,
} from "./types.js";

export function lifecycleStateLabel(state: MerchantLifecycleState): string {
  switch (state) {
    case "DRAFT":
      return "Add your business details to continue";
    case "CONNECTING":
      return "Connect your product catalog";
    case "MAPPING":
      return "Reviewing your catalog";
    case "VERIFYING":
      return "Verifying your setup";
    case "SANDBOX_READY":
      return "Ready for a test transaction";
    case "ACTIVATION_REVIEW":
      return "Under review before going live";
    case "ACTIVE":
      return "Live and accepting real transactions";
    case "ACTIVE_DEGRADED":
      return "Live, with a limitation Counter is tracking";
    case "SUSPENDED":
      return "Temporarily suspended";
    case "OFFBOARDING":
      return "Being closed down";
    case "CLOSED":
      return "Closed";
  }
}

export const FULFILLMENT_CAPABILITY_OPTIONS: ReadonlyArray<{
  readonly value: FulfillmentCapability;
  readonly label: string;
}> = [
  { value: "fulfillment.physical.ship", label: "Ships physical items" },
  { value: "fulfillment.digital.deliver", label: "Delivers digital files instantly" },
  {
    value: "fulfillment.access.grant",
    label: "Grants ongoing access (subscriptions/memberships)",
  },
  { value: "fulfillment.booking.schedule", label: "Books appointments" },
  { value: "fulfillment.event.ticket", label: "Sells tickets/reservations" },
  { value: "fulfillment.rental.temporary", label: "Rents out items temporarily" },
  { value: "fulfillment.quote.custom", label: "Custom quotes, no fixed price" },
];

/** Plain-language name for each readiness dimension — never show the raw checkKind. */
export function readinessCheckLabel(kind: WizardReadinessCheckKind): string {
  switch (kind) {
    case "connector_health":
      return "Catalog connected";
    case "mapping_freshness":
      return "Catalog reviewed";
    case "policy_compiled":
      return "Selling rules set up";
    case "payment_configured":
      return "Payments connected";
    case "protocol_version":
      return "Counter protocol version";
  }
}

/** Whether a readiness check counts as passing for the purposes of a ✓/✗ display. */
export function readinessCheckPassed(status: WizardReadinessCheckStatus): boolean {
  return status !== "Blocking";
}

/** Plain-language name for each of the 5 static PILOT_CAPABILITIES (never shown as a raw wire value). */
export const PILOT_CAPABILITY_LABELS: Readonly<Record<string, string>> = {
  "quote.create": "Create price quotes",
  "quote.accept": "Accept price quotes",
  "payment.initiate": "Start payments",
  "payment.confirm": "Confirm payments",
  "refund.initiate": "Start refunds",
};

export function pilotCapabilityLabel(value: string): string {
  return PILOT_CAPABILITY_LABELS[value] ?? value;
}

export function fulfillmentCapabilityLabel(value: string): string {
  const match = FULFILLMENT_CAPABILITY_OPTIONS.find((option) => option.value === value);
  return match?.label ?? value;
}
