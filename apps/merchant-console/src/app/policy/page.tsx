"use client";

import { useEffect, useState, type ReactNode } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  CardDescription,
  Button,
  Input,
  Switch,
  Badge,
  Skeleton,
  ErrorState,
  toast,
} from "@counter/ui";
import { Shield, Save } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";
import { getApiClient, useApi, useCurrentMerchantId } from "@/hooks/use-api";
import type {
  MerchantPolicyRuleConfig,
  PolicyConfigView,
  PolicyPaymentMethod,
  SavePolicyRequest,
} from "@/lib/types";

// ---------------------------------------------------------------------------
// Scope of this editor, disclosed plainly (per this task's own instructions):
// @counter/merchant-policy defines 12 real rule kinds. This first pass
// exposes the 7 most practically useful for a merchant deciding "what my
// agent is allowed to sell and how": category-allowlist, quantity-limit,
// review-threshold, refund-policy, payment-path, inr-only, and
// india-destination. The remaining 5 (product-allowlist, count-limit,
// operating-window, freshness-requirement, cancellation-policy) are real in
// the data model and compiler and are enforced wherever this codebase reads
// them, but have no editor control here yet — a rule of one of those kinds
// set via the API directly still round-trips through GET correctly (see
// the raw-rules note below), it just can't be authored from this page.
//
// review-threshold is NOT a hard price ceiling: it means "a human should
// review purchases above this amount" (see ReviewThresholdRule's own
// semantics in packages/merchant-policy/src/policy-config.ts) — framed that
// way here, not mislabeled as a spending limit.
// ---------------------------------------------------------------------------

const PAYMENT_METHODS: readonly { id: PolicyPaymentMethod; label: string }[] = [
  { id: "upi", label: "UPI" },
  { id: "card", label: "Card" },
  { id: "netbanking", label: "Net banking" },
  { id: "wallet", label: "Wallet" },
  { id: "bank_transfer", label: "Bank transfer" },
  { id: "bnpl", label: "Buy now, pay later" },
];

interface EditableState {
  categoryAllowlist: { enabled: boolean; categories: string };
  quantityLimit: { enabled: boolean; maxQuantity: string };
  reviewThreshold: { enabled: boolean; amountRupees: string };
  refundPolicy: {
    enabled: boolean;
    maxRefundWindowDays: string;
    partialRefundAllowed: boolean;
  };
  paymentPath: { enabled: boolean; methods: Record<PolicyPaymentMethod, boolean> };
  inrOnly: { enabled: boolean };
  indiaDestination: { enabled: boolean; destinations: string };
}

function defaultMethods(): Record<PolicyPaymentMethod, boolean> {
  return {
    upi: false,
    card: false,
    netbanking: false,
    wallet: false,
    bank_transfer: false,
    bnpl: false,
  };
}

function emptyState(): EditableState {
  return {
    categoryAllowlist: { enabled: false, categories: "" },
    quantityLimit: { enabled: false, maxQuantity: "" },
    reviewThreshold: { enabled: false, amountRupees: "" },
    refundPolicy: { enabled: false, maxRefundWindowDays: "", partialRefundAllowed: false },
    paymentPath: { enabled: false, methods: defaultMethods() },
    inrOnly: { enabled: false },
    indiaDestination: { enabled: false, destinations: "IN" },
  };
}

/** Loads the 7 editable rule kinds out of the real rule list; any other rule kind is preserved untouched (see PASSTHROUGH note below) rather than silently dropped on save. */
function loadFromRules(rules: readonly MerchantPolicyRuleConfig[]): {
  state: EditableState;
  passthrough: readonly MerchantPolicyRuleConfig[];
} {
  const state = emptyState();
  const passthrough: MerchantPolicyRuleConfig[] = [];
  for (const rule of rules) {
    switch (rule.kind) {
      case "category-allowlist":
        state.categoryAllowlist = { enabled: true, categories: rule.categories.join(", ") };
        break;
      case "quantity-limit":
        state.quantityLimit = { enabled: true, maxQuantity: rule.maxQuantity.value };
        break;
      case "review-threshold": {
        const rupees = Number(rule.thresholdAmount.amountMinor) / 100;
        state.reviewThreshold = { enabled: true, amountRupees: String(rupees) };
        break;
      }
      case "refund-policy":
        state.refundPolicy = {
          enabled: true,
          maxRefundWindowDays: String(Math.round(rule.maxRefundWindowMs / 86_400_000)),
          partialRefundAllowed: rule.partialRefundAllowed,
        };
        break;
      case "payment-path": {
        const methods = defaultMethods();
        for (const m of rule.allowedMethods) methods[m] = true;
        state.paymentPath = { enabled: true, methods };
        break;
      }
      case "inr-only":
        state.inrOnly = { enabled: true };
        break;
      case "india-destination":
        state.indiaDestination = {
          enabled: true,
          destinations: rule.allowedDestinations.join(", "),
        };
        break;
      default:
        // product-allowlist, count-limit, operating-window,
        // freshness-requirement, cancellation-policy — real rule kinds this
        // editor doesn't yet expose controls for. Preserved as-is on save
        // rather than silently deleted just because this page can't edit them.
        passthrough.push(rule);
    }
  }
  return { state, passthrough };
}

function parseCommaList(value: string): string[] {
  return value
    .split(",")
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}

function buildRules(
  state: EditableState,
  passthrough: readonly MerchantPolicyRuleConfig[],
): MerchantPolicyRuleConfig[] {
  const rules: MerchantPolicyRuleConfig[] = [...passthrough];

  if (state.categoryAllowlist.enabled) {
    rules.push({
      kind: "category-allowlist",
      categories: parseCommaList(state.categoryAllowlist.categories),
    });
  }
  if (state.quantityLimit.enabled) {
    rules.push({
      kind: "quantity-limit",
      maxQuantity: { value: state.quantityLimit.maxQuantity.trim() || "0", unit: "item" },
    });
  }
  if (state.reviewThreshold.enabled) {
    const rupees = Number(state.reviewThreshold.amountRupees);
    const amountMinor = Number.isFinite(rupees) ? Math.round(rupees * 100) : 0;
    rules.push({
      kind: "review-threshold",
      thresholdAmount: { amountMinor: String(amountMinor), currency: "INR" },
    });
  }
  if (state.refundPolicy.enabled) {
    const days = Number(state.refundPolicy.maxRefundWindowDays);
    const maxRefundWindowMs = Number.isFinite(days) ? Math.round(days * 86_400_000) : 0;
    rules.push({
      kind: "refund-policy",
      maxRefundWindowMs,
      partialRefundAllowed: state.refundPolicy.partialRefundAllowed,
    });
  }
  if (state.paymentPath.enabled) {
    const allowedMethods = PAYMENT_METHODS.filter((m) => state.paymentPath.methods[m.id]).map(
      (m) => m.id,
    );
    rules.push({ kind: "payment-path", allowedMethods });
  }
  if (state.inrOnly.enabled) {
    rules.push({ kind: "inr-only" });
  }
  if (state.indiaDestination.enabled) {
    rules.push({
      kind: "india-destination",
      allowedDestinations: parseCommaList(state.indiaDestination.destinations),
    });
  }

  return rules;
}

function RuleSection(props: {
  title: string;
  description: string;
  enabled: boolean;
  onToggle: (enabled: boolean) => void;
  children?: ReactNode;
}) {
  return (
    <Card>
      <CardContent className="p-5">
        <div className="flex items-start justify-between gap-4">
          <div>
            <p className="font-medium text-[var(--foreground)]">{props.title}</p>
            <p className="mt-0.5 text-sm text-[var(--foreground-muted)]">{props.description}</p>
          </div>
          <Switch checked={props.enabled} onCheckedChange={props.onToggle} />
        </div>
        {props.enabled && props.children && (
          <div className="mt-4 space-y-3 border-t border-[var(--border)] pt-4">
            {props.children}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

function FieldLabel(props: { children: ReactNode }) {
  return (
    <label className="mb-1 block text-xs font-medium text-[var(--foreground-secondary)]">
      {props.children}
    </label>
  );
}

export default function PolicyPage() {
  const { merchantId, loading: merchantLoading, error: merchantError } = useCurrentMerchantId();
  const {
    data,
    loading: policyLoading,
    error: policyError,
    refetch,
  } = useApi<PolicyConfigView | null>(
    (client) =>
      merchantId
        ? client.getPolicyConfig(merchantId)
        : Promise.resolve({ ok: true, data: null as PolicyConfigView | null }),
    [merchantId],
  );

  const [state, setState] = useState<EditableState>(emptyState());
  const [passthrough, setPassthrough] = useState<readonly MerchantPolicyRuleConfig[]>([]);
  const [effectiveFrom, setEffectiveFrom] = useState<string | undefined>(undefined);
  const [version, setVersion] = useState<number | undefined>(undefined);
  const [summary, setSummary] = useState<readonly string[]>([]);
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (data === null) {
      setState(emptyState());
      setPassthrough([]);
      setEffectiveFrom(undefined);
      setVersion(undefined);
      setSummary([]);
      return;
    }
    const { state: loaded, passthrough: rest } = loadFromRules(data.policy.rules);
    setState(loaded);
    setPassthrough(rest);
    setEffectiveFrom(data.policy.effectiveFrom);
    setVersion(data.policy.version);
    setSummary(data.summary);
  }, [data]);

  const loading = merchantLoading || policyLoading;
  const error = merchantError ?? policyError;

  async function handleSave() {
    if (merchantId === undefined) return;
    setSaving(true);
    try {
      const client = getApiClient();
      const rules = buildRules(state, passthrough);
      if (rules.length === 0) {
        toast.error("Turn on at least one rule before saving");
        return;
      }
      const request: SavePolicyRequest = {
        rules,
        effectiveFrom: effectiveFrom ?? new Date().toISOString(),
        effectiveUntil: null,
      };
      const result = await client.savePolicyConfig(merchantId, request, version);
      if (!result.ok) {
        if (result.error.code === "CONFLICT") {
          toast.error(result.error.message);
          refetch();
          return;
        }
        toast.error(result.error.message);
        return;
      }
      toast.success("Policy saved");
      setVersion(Number(result.data.policyVersion));
      setSummary(result.data.compiled.summary);
      refetch();
    } finally {
      setSaving(false);
    }
  }

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div className="flex items-start justify-between gap-4 border-b border-[var(--border-secondary)] pb-5">
          <div>
            <p className="font-mono text-xs uppercase tracking-widest text-[var(--foreground-muted)] mb-2" data-manifest-figure>
              Controls
            </p>
            <h1 className="font-display text-2xl font-semibold text-[var(--foreground)]">
              Selling policy
            </h1>
            <p className="mt-1 text-[var(--foreground-secondary)]">
              Decide what your agent is allowed to sell and how — turn on the rules you want and
              save. These rules are enforced for real at checkout.
            </p>
          </div>
          <Button onClick={() => void handleSave()} disabled={saving || loading} className="shrink-0">
            <Save className="mr-2 h-4 w-4" />
            {saving ? "Saving…" : "Save policy"}
          </Button>
        </div>

        {loading ? (
          <div className="space-y-3">
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
            <Skeleton className="h-10 w-full" />
          </div>
        ) : error ? (
          <ErrorState message={error} onRetry={refetch} />
        ) : (
          <>
            <Card>
              <CardHeader>
                <CardTitle className="flex items-center gap-2 text-base">
                  <Shield className="h-4 w-4 text-[var(--brand-red)]" />
                  In plain language
                </CardTitle>
                <CardDescription>
                  {data === null
                    ? "No policy configured yet — your agent has no restrictions from this page until you turn on a rule below and save."
                    : "This is exactly what's enforced right now, generated from your saved rules."}
                </CardDescription>
              </CardHeader>
              {summary.length > 0 && (
                <CardContent className="flex flex-wrap gap-2 pt-0">
                  {summary.map((line) => (
                    <Badge key={line} variant="secondary" className="font-normal">
                      {line}
                    </Badge>
                  ))}
                </CardContent>
              )}
            </Card>

            <div className="space-y-3">
              <RuleSection
                title="Only sell these categories"
                description="Restrict your agent to specific product categories."
                enabled={state.categoryAllowlist.enabled}
                onToggle={(enabled) =>
                  setState((s) => ({
                    ...s,
                    categoryAllowlist: { ...s.categoryAllowlist, enabled },
                  }))
                }
              >
                <FieldLabel>Allowed categories (comma-separated)</FieldLabel>
                <Input
                  value={state.categoryAllowlist.categories}
                  placeholder="electronics, home-goods"
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      categoryAllowlist: { ...s.categoryAllowlist, categories: e.target.value },
                    }))
                  }
                />
              </RuleSection>

              <RuleSection
                title="Limit quantity per order"
                description="Cap how many units of an item an agent can buy in one order."
                enabled={state.quantityLimit.enabled}
                onToggle={(enabled) =>
                  setState((s) => ({ ...s, quantityLimit: { ...s.quantityLimit, enabled } }))
                }
              >
                <FieldLabel>Maximum quantity per order</FieldLabel>
                <Input
                  type="number"
                  min="1"
                  value={state.quantityLimit.maxQuantity}
                  placeholder="5"
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      quantityLimit: { ...s.quantityLimit, maxQuantity: e.target.value },
                    }))
                  }
                />
              </RuleSection>

              <RuleSection
                title="Flag large purchases for review"
                description="This does not block a sale — it marks purchases above this amount as needing your review. It is not a hard spending cap."
                enabled={state.reviewThreshold.enabled}
                onToggle={(enabled) =>
                  setState((s) => ({ ...s, reviewThreshold: { ...s.reviewThreshold, enabled } }))
                }
              >
                <FieldLabel>Review threshold (INR)</FieldLabel>
                <Input
                  type="number"
                  min="0"
                  value={state.reviewThreshold.amountRupees}
                  placeholder="5000"
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      reviewThreshold: { ...s.reviewThreshold, amountRupees: e.target.value },
                    }))
                  }
                />
              </RuleSection>

              <RuleSection
                title="Refund policy"
                description="How long after a purchase a refund can be requested."
                enabled={state.refundPolicy.enabled}
                onToggle={(enabled) =>
                  setState((s) => ({ ...s, refundPolicy: { ...s.refundPolicy, enabled } }))
                }
              >
                <FieldLabel>Refund window (days)</FieldLabel>
                <Input
                  type="number"
                  min="0"
                  value={state.refundPolicy.maxRefundWindowDays}
                  placeholder="14"
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      refundPolicy: { ...s.refundPolicy, maxRefundWindowDays: e.target.value },
                    }))
                  }
                />
                <div className="flex items-center gap-2 pt-1">
                  <Switch
                    checked={state.refundPolicy.partialRefundAllowed}
                    onCheckedChange={(partialRefundAllowed) =>
                      setState((s) => ({
                        ...s,
                        refundPolicy: { ...s.refundPolicy, partialRefundAllowed },
                      }))
                    }
                  />
                  <span className="text-sm text-[var(--foreground-secondary)]">
                    Allow partial refunds
                  </span>
                </div>
              </RuleSection>

              <RuleSection
                title="Accepted payment methods"
                description="Only allow purchases through these payment rails."
                enabled={state.paymentPath.enabled}
                onToggle={(enabled) =>
                  setState((s) => ({ ...s, paymentPath: { ...s.paymentPath, enabled } }))
                }
              >
                <div className="flex flex-wrap gap-3">
                  {PAYMENT_METHODS.map((m) => (
                    <label key={m.id} className="flex items-center gap-2 text-sm">
                      <input
                        type="checkbox"
                        checked={state.paymentPath.methods[m.id]}
                        onChange={(e) =>
                          setState((s) => ({
                            ...s,
                            paymentPath: {
                              ...s.paymentPath,
                              methods: { ...s.paymentPath.methods, [m.id]: e.target.checked },
                            },
                          }))
                        }
                      />
                      {m.label}
                    </label>
                  ))}
                </div>
              </RuleSection>

              <RuleSection
                title="INR only"
                description="Refuse any purchase not priced in Indian Rupees."
                enabled={state.inrOnly.enabled}
                onToggle={(enabled) => setState((s) => ({ ...s, inrOnly: { enabled } }))}
              />

              <RuleSection
                title="Ship within India only"
                description="Only allow purchases delivering to these destination countries."
                enabled={state.indiaDestination.enabled}
                onToggle={(enabled) =>
                  setState((s) => ({ ...s, indiaDestination: { ...s.indiaDestination, enabled } }))
                }
              >
                <FieldLabel>Allowed destination countries (comma-separated ISO codes)</FieldLabel>
                <Input
                  value={state.indiaDestination.destinations}
                  placeholder="IN"
                  onChange={(e) =>
                    setState((s) => ({
                      ...s,
                      indiaDestination: { ...s.indiaDestination, destinations: e.target.value },
                    }))
                  }
                />
              </RuleSection>
            </div>

            {passthrough.length > 0 && (
              <Card>
                <CardContent className="p-4 text-sm text-[var(--foreground-muted)]">
                  {passthrough.length} additional rule(s) configured elsewhere (
                  {passthrough.map((r) => r.kind).join(", ")}) are kept as-is — this page doesn't
                  yet have editing controls for them.
                </CardContent>
              </Card>
            )}
          </>
        )}
      </div>
    </PageWrapper>
  );
}
