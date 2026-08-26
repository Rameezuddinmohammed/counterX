/**
 * Plain-language consent text generation for wallet operations.
 *
 * Each consent text template has a version number that is immutable once
 * assigned. When consent language changes, the version is incremented.
 * Rendered consent text is deterministic for the same inputs and version.
 */

// ---------------------------------------------------------------------------
// Consent Operation Types
// ---------------------------------------------------------------------------

export const CONSENT_OPERATION_TYPES = [
  "mandate_creation",
  "policy_widening",
  "payment_reference_binding",
  "agent_key_rotation",
  "wallet_closure",
  "data_export",
  "recovery_initiation",
  "approval_delegation",
] as const;

export type ConsentOperationType = (typeof CONSENT_OPERATION_TYPES)[number];

const consentOperationTypeSet: ReadonlySet<string> = new Set(CONSENT_OPERATION_TYPES);

export function isConsentOperationType(value: unknown): value is ConsentOperationType {
  return typeof value === "string" && consentOperationTypeSet.has(value);
}

// ---------------------------------------------------------------------------
// Consent Text Template
// ---------------------------------------------------------------------------

export interface ConsentTextTemplate {
  readonly operation: ConsentOperationType;
  readonly version: string;
  readonly template: string;
}

// ---------------------------------------------------------------------------
// Consent Text Templates (versioned, immutable per version)
// ---------------------------------------------------------------------------

const CONSENT_TEMPLATES: readonly ConsentTextTemplate[] = [
  {
    operation: "mandate_creation",
    version: "1.0",
    template:
      "I authorize the creation of a purchase mandate for merchant '{merchant}' " +
      "with a per-transaction limit of {currency} {amount}. This mandate allows " +
      "the designated agent to make purchases on my behalf within the specified limits.",
  },
  {
    operation: "policy_widening",
    version: "1.0",
    template:
      "I consent to widening my buyer policy to include the following changes: {changes}. " +
      "I understand this increases the scope of authorized transactions.",
  },
  {
    operation: "payment_reference_binding",
    version: "1.0",
    template:
      "I authorize binding payment reference '{reference}' to my wallet for use in " +
      "authorized transactions. I confirm this payment method belongs to me.",
  },
  {
    operation: "agent_key_rotation",
    version: "1.0",
    template:
      "I authorize the rotation of the signing key for agent '{agent}'. " +
      "The previous key will be revoked and replaced with a new key.",
  },
  {
    operation: "wallet_closure",
    version: "1.0",
    template:
      "I confirm my request to permanently close my wallet. I understand this action " +
      "is irreversible and all active mandates, policies, and agent registrations " +
      "will be revoked.",
  },
  {
    operation: "data_export",
    version: "1.0",
    template:
      "I request an export of all data associated with my wallet, including " +
      "transaction history, policies, mandates, and consent records. " +
      "The export will be delivered to '{destination}'.",
  },
  {
    operation: "recovery_initiation",
    version: "1.0",
    template:
      "I am initiating account recovery for my wallet. I confirm my identity " +
      "via {method} and authorize the recovery process to proceed.",
  },
  {
    operation: "approval_delegation",
    version: "1.0",
    template:
      "I approve the pending transaction '{transaction_id}' for {currency} {amount} " +
      "with merchant '{merchant}'. This approval authorizes the agent to complete " +
      "the purchase.",
  },
] as const;

// ---------------------------------------------------------------------------
// Render Parameters
// ---------------------------------------------------------------------------

export interface ConsentRenderParams {
  readonly operation: ConsentOperationType;
  readonly variables: Readonly<Record<string, string>>;
}

// ---------------------------------------------------------------------------
// Rendered Consent Text
// ---------------------------------------------------------------------------

export interface RenderedConsentText {
  readonly operation: ConsentOperationType;
  readonly version: string;
  readonly text: string;
}

// ---------------------------------------------------------------------------
// ConsentTextRenderer
// ---------------------------------------------------------------------------

export class ConsentTextRenderer {
  private readonly templates: ReadonlyMap<ConsentOperationType, ConsentTextTemplate>;

  constructor() {
    const map = new Map<ConsentOperationType, ConsentTextTemplate>();
    for (const template of CONSENT_TEMPLATES) {
      map.set(template.operation, template);
    }
    this.templates = map;
  }

  /**
   * Renders consent text for the given operation, substituting variables.
   * Returns undefined if the operation type is unknown.
   */
  render(params: ConsentRenderParams): RenderedConsentText | undefined {
    const template = this.templates.get(params.operation);
    if (!template) {
      return undefined;
    }

    let text = template.template;
    for (const [key, value] of Object.entries(params.variables)) {
      text = text.replaceAll(`{${key}}`, value);
    }

    return {
      operation: params.operation,
      version: template.version,
      text,
    };
  }

  /**
   * Returns the template version for a given operation.
   */
  getVersion(operation: ConsentOperationType): string | undefined {
    return this.templates.get(operation)?.version;
  }

  /**
   * Returns all supported operations with their versions.
   */
  getSupportedOperations(): readonly { operation: ConsentOperationType; version: string }[] {
    const result: { operation: ConsentOperationType; version: string }[] = [];
    for (const [operation, template] of this.templates) {
      result.push({ operation, version: template.version });
    }
    return result;
  }
}
