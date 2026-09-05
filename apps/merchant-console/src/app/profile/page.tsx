"use client";

import { useEffect, useState } from "react";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
  Avatar,
  AvatarFallback,
  Badge,
  Button,
  Input,
  Separator,
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
  toast,
} from "@counter/ui";
import {
  Mail,
  Store,
  Phone,
  Copy,
  Check,
  Edit2,
  ExternalLink,
  ShoppingBag,
  CreditCard,
  Building,
} from "lucide-react";
import Link from "next/link";
import { PageWrapper } from "@/components/page-wrapper";
import { getApiClient, useApi, useCurrentMerchantId } from "@/hooks/use-api";
import type {
  MerchantApplicationStatus,
  ShopifyConnectionStatus,
  FulfillmentCapability,
  BusinessBasicsRequest,
} from "@/lib/types";
import type { SessionIdentity } from "@/app/api/session/route";

export default function ProfilePage() {
  const { merchantId } = useCurrentMerchantId();
  const [session, setSession] = useState<SessionIdentity | null>(null);
  const [copiedId, setCopiedId] = useState(false);

  // Edit business details dialog state
  const [editOpen, setEditOpen] = useState(false);
  const [editLegalName, setEditLegalName] = useState("");
  const [editEmail, setEditEmail] = useState("");
  const [editPhone, setEditPhone] = useState("");
  const [saving, setSaving] = useState(false);

  // 1. Fetch real session info
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/session");
        if (res.ok) {
          const data = (await res.json()) as SessionIdentity;
          if (!cancelled) setSession(data);
        }
      } catch {
        // Fallback gracefully
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // 2. Fetch real merchant application details
  const {
    data: application,
    refetch: refetchApplication,
  } = useApi<MerchantApplicationStatus | null>(
    (client) =>
      merchantId
        ? client.getMerchantApplication(merchantId).then((res) => (res.ok ? { ok: true, data: res.data } : { ok: true, data: null }))
        : Promise.resolve({ ok: true, data: null }),
    [merchantId],
  );

  // 3. Fetch real Shopify connection status
  const { data: shopify } = useApi(
    (client) =>
      merchantId
        ? client.getShopifyConnectionStatus(merchantId)
        : Promise.resolve({
            ok: true as const,
            data: { connected: false } satisfies ShopifyConnectionStatus,
          }),
    [merchantId],
  );

  const displayName = session?.name ?? session?.email ?? application?.legalEntityName ?? "Merchant";
  const initials = (session?.name
    ? session.name
        .split(" ")
        .map((n) => n[0])
        .join("")
        .slice(0, 2)
    : (session?.email?.slice(0, 2) ?? "MC")
  ).toUpperCase();

  const handleCopyMerchantId = () => {
    if (!merchantId) return;
    void navigator.clipboard.writeText(merchantId);
    setCopiedId(true);
    toast.success("Merchant ID copied to clipboard");
    setTimeout(() => setCopiedId(false), 2000);
  };

  const openEditModal = () => {
    setEditLegalName(application?.legalEntityName ?? displayName);
    setEditEmail(application?.contactEmail ?? session?.email ?? "");
    setEditPhone(application?.contactPhone ?? "");
    setEditOpen(true);
  };

  const handleSaveBusinessBasics = async () => {
    if (!merchantId) return;
    if (!editLegalName.trim()) {
      toast.error("Business name is required");
      return;
    }
    if (!editEmail.trim()) {
      toast.error("Contact email is required");
      return;
    }

    setSaving(true);
    try {
      const client = getApiClient();
      const goodsTypes: FulfillmentCapability[] =
        application?.goodsTypes && application.goodsTypes.length > 0
          ? (application.goodsTypes as FulfillmentCapability[])
          : ["fulfillment.physical.ship"];

      const req: BusinessBasicsRequest = {
        legalEntityName: editLegalName.trim(),
        contactEmail: editEmail.trim(),
        goodsTypes,
        ...(editPhone.trim() ? { contactPhone: editPhone.trim() } : {}),
      };

      const res = await client.updateBusinessBasics(merchantId, req);

      if (!res.ok) {
        toast.error(res.error.message || "Failed to update business details");
        return;
      }

      toast.success("Business details updated successfully");
      setEditOpen(false);
      refetchApplication();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : "Error saving details");
    } finally {
      setSaving(false);
    }
  };

  const formatLifecycle = (state?: string) => {
    if (!state) return { label: "Active Sandbox", variant: "info" as const };
    switch (state) {
      case "ACTIVE":
        return { label: "Live Active", variant: "success" as const };
      case "MAPPING":
      case "CONNECTING":
      case "VERIFYING":
        return { label: "Setup In Progress", variant: "warning" as const };
      case "DRAFT":
        return { label: "Draft Application", variant: "secondary" as const };
      default:
        return { label: state, variant: "default" as const };
    }
  };

  const lifecycle = formatLifecycle(application?.lifecycleState);

  return (
    <PageWrapper>
      <div className="space-y-6 max-w-4xl">
        <div>
          <h1 className="text-3xl font-extrabold tracking-tight text-[var(--foreground)]">Profile</h1>
          <p className="mt-1 text-sm text-[var(--foreground-secondary)]">
            Manage your account identity, merchant store details, and integration statuses.
          </p>
        </div>

        {/* Real User Profile Card */}
        <Card className="border-[var(--border)] shadow-xs">
          <CardContent className="p-6">
            <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-6">
              <div className="flex items-center gap-5">
                <Avatar className="h-20 w-20 border-2 border-indigo-500/20 shadow-sm">
                  {session?.picture ? (
                    <img
                      src={session.picture}
                      alt={displayName}
                      className="h-full w-full rounded-full object-cover"
                    />
                  ) : (
                    <AvatarFallback className="bg-indigo-500/15 text-indigo-500 dark:text-indigo-400 text-2xl font-bold font-mono">
                      {initials}
                    </AvatarFallback>
                  )}
                </Avatar>
                <div>
                  <div className="flex items-center gap-3">
                    <h2 className="text-xl font-bold text-[var(--foreground)]">{displayName}</h2>
                    <Badge variant={lifecycle.variant}>{lifecycle.label}</Badge>
                  </div>
                  {session?.email && (
                    <p className="text-sm text-[var(--foreground-secondary)] mt-0.5 font-mono">
                      {session.email}
                    </p>
                  )}
                  <div className="mt-2.5 flex items-center gap-2">
                    <Badge variant="default" className="text-xs">
                      {session?.roles?.[0] ? session.roles[0].replace(".", " ") : "Store Owner"}
                    </Badge>
                    <Badge variant="outline" className="text-xs font-mono">
                      Assurance: {session?.assurance ?? "step_up"}
                    </Badge>
                  </div>
                </div>
              </div>

              <div className="flex flex-col sm:items-end gap-2">
                <Button variant="outline" size="sm" onClick={openEditModal} className="gap-1.5">
                  <Edit2 className="h-3.5 w-3.5" />
                  Edit Business Details
                </Button>
                <a href="/auth/logout" className="text-xs text-rose-500 hover:underline">
                  Sign out of Counter
                </a>
              </div>
            </div>
          </CardContent>
        </Card>

        {/* Business & Store Details */}
        <Card className="border-[var(--border)] shadow-xs">
          <CardHeader className="flex flex-row items-center justify-between pb-3">
            <div>
              <CardTitle className="text-base font-semibold">Store & Entity Details</CardTitle>
              <p className="text-xs text-[var(--foreground-muted)] mt-0.5">
                Official registration and contact information registered with Counter.
              </p>
            </div>
            <Button variant="ghost" size="sm" onClick={openEditModal} className="text-xs gap-1">
              <Edit2 className="h-3 w-3" />
              Edit
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="flex items-start gap-3 p-3 rounded-xl bg-[var(--surface-secondary)]/50 border border-[var(--border)]">
                <Store className="h-4 w-4 text-[var(--foreground-muted)] mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-[var(--foreground-muted)]">Legal Business Name</p>
                  <p className="text-sm font-semibold text-[var(--foreground)] truncate mt-0.5">
                    {application?.legalEntityName || displayName}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-xl bg-[var(--surface-secondary)]/50 border border-[var(--border)]">
                <Building className="h-4 w-4 text-[var(--foreground-muted)] mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-[var(--foreground-muted)]">Merchant Account ID</p>
                  <div className="flex items-center gap-2 mt-0.5">
                    <p className="text-xs font-mono font-semibold text-[var(--foreground)] truncate">
                      {merchantId ?? "Not provisioned yet"}
                    </p>
                    {merchantId && (
                      <button
                        onClick={handleCopyMerchantId}
                        className="text-[var(--foreground-muted)] hover:text-[var(--foreground)] transition-colors p-1"
                        title="Copy Merchant ID"
                      >
                        {copiedId ? (
                          <Check className="h-3.5 w-3.5 text-emerald-500" />
                        ) : (
                          <Copy className="h-3.5 w-3.5" />
                        )}
                      </button>
                    )}
                  </div>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-xl bg-[var(--surface-secondary)]/50 border border-[var(--border)]">
                <Mail className="h-4 w-4 text-[var(--foreground-muted)] mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-[var(--foreground-muted)]">Contact Email</p>
                  <p className="text-sm font-semibold text-[var(--foreground)] truncate mt-0.5">
                    {application?.contactEmail || session?.email || "Not set"}
                  </p>
                </div>
              </div>

              <div className="flex items-start gap-3 p-3 rounded-xl bg-[var(--surface-secondary)]/50 border border-[var(--border)]">
                <Phone className="h-4 w-4 text-[var(--foreground-muted)] mt-0.5" />
                <div className="flex-1 min-w-0">
                  <p className="text-xs text-[var(--foreground-muted)]">Contact Phone</p>
                  <p className="text-sm font-semibold text-[var(--foreground)] truncate mt-0.5">
                    {application?.contactPhone || "Not provided"}
                  </p>
                </div>
              </div>
            </div>

            <Separator />

            <div className="flex items-center justify-between text-xs text-[var(--foreground-muted)] pt-1">
              <span>
                Environment: <strong className="text-[var(--foreground)]">Test Sandbox</strong>
              </span>
              <span>
                Approval Status:{" "}
                <strong className="capitalize text-[var(--foreground)]">
                  {application?.approvalStatus ?? "Approved"}
                </strong>
              </span>
            </div>
          </CardContent>
        </Card>

        {/* Connected Services */}
        <Card className="border-[var(--border)] shadow-xs">
          <CardHeader className="pb-3">
            <CardTitle className="text-base font-semibold">Connected Services</CardTitle>
            <p className="text-xs text-[var(--foreground-muted)] mt-0.5">
              Integrations enabling autonomous AI agents to query and checkout your products.
            </p>
          </CardHeader>
          <CardContent className="space-y-3">
            {/* Shopify */}
            <div className="flex items-center justify-between rounded-xl border border-[var(--border)] p-4 bg-[var(--surface-secondary)]/30">
              <div className="flex items-center gap-3.5">
                <div className="h-10 w-10 rounded-xl bg-[#96BF48]/15 flex items-center justify-center text-[#96BF48]">
                  <ShoppingBag className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-[var(--foreground)]">Shopify Store</p>
                    <Badge variant={shopify?.connected ? "success" : "secondary"}>
                      {shopify?.connected ? "Live Connected" : "Not connected"}
                    </Badge>
                  </div>
                  <p className="text-xs text-[var(--foreground-muted)] font-mono mt-0.5">
                    {shopify?.connected ? shopify.shopDomain : "Connect your Shopify catalog"}
                  </p>
                </div>
              </div>
              <Link href="/shopify">
                <Button size="sm" variant={shopify?.connected ? "outline" : "default"} className="gap-1.5 text-xs">
                  {shopify?.connected ? "Manage Store" : "Connect"}
                  <ExternalLink className="h-3 w-3" />
                </Button>
              </Link>
            </div>

            {/* Payment Gateway */}
            <div className="flex items-center justify-between rounded-xl border border-[var(--border)] p-4 bg-[var(--surface-secondary)]/30">
              <div className="flex items-center gap-3.5">
                <div className="h-10 w-10 rounded-xl bg-blue-500/15 flex items-center justify-center text-blue-500">
                  <CreditCard className="h-5 w-5" />
                </div>
                <div>
                  <div className="flex items-center gap-2">
                    <p className="text-sm font-semibold text-[var(--foreground)]">Payment Gateway</p>
                    <Badge variant="secondary">Coming soon</Badge>
                  </div>
                  <p className="text-xs text-[var(--foreground-muted)] mt-0.5">
                    Direct payment routing & custom gateway settlements.
                  </p>
                </div>
              </div>
              <Link href="/razorpay">
                <Button size="sm" variant="ghost" className="text-xs">
                  View Status
                </Button>
              </Link>
            </div>
          </CardContent>
        </Card>
      </div>

      {/* Edit Business Details Dialog */}
      <Dialog open={editOpen} onOpenChange={setEditOpen}>
        <DialogContent className="sm:max-w-md">
          <DialogHeader>
            <DialogTitle>Edit Business Details</DialogTitle>
            <DialogDescription>
              Update your legal entity and contact information registered with Counter.
            </DialogDescription>
          </DialogHeader>

          <div className="space-y-4 py-2">
            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[var(--foreground)]" htmlFor="edit-legal-name">
                Legal Entity Name
              </label>
              <Input
                id="edit-legal-name"
                value={editLegalName}
                onChange={(e) => setEditLegalName(e.target.value)}
                placeholder="e.g. Acme Corp India Pvt Ltd"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[var(--foreground)]" htmlFor="edit-email">
                Contact Email
              </label>
              <Input
                id="edit-email"
                type="email"
                value={editEmail}
                onChange={(e) => setEditEmail(e.target.value)}
                placeholder="billing@yourstore.com"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-xs font-semibold text-[var(--foreground)]" htmlFor="edit-phone">
                Contact Phone (optional)
              </label>
              <Input
                id="edit-phone"
                value={editPhone}
                onChange={(e) => setEditPhone(e.target.value)}
                placeholder="+91 9876543210"
              />
            </div>
          </div>

          <DialogFooter className="gap-2 sm:gap-0">
            <Button variant="outline" onClick={() => setEditOpen(false)} disabled={saving}>
              Cancel
            </Button>
            <Button onClick={() => void handleSaveBusinessBasics()} disabled={saving}>
              {saving ? "Saving…" : "Save Changes"}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </PageWrapper>
  );
}
