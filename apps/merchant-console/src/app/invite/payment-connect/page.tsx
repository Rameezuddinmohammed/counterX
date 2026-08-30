"use client";

/**
 * Onboarding wizard Step 4: own-gateway Razorpay payment connect.
 *
 * SCOPE BOUNDARY, disclosed plainly to the merchant below too: this proves
 * you own working Razorpay credentials and records that fact — it does NOT
 * yet mean real transactions run through these exact credentials. Counter's
 * checkout today runs on one shared Counter-operated Razorpay account while
 * per-merchant billing is being built; that work is a separate, larger
 * follow-up. See apps/control-plane-api/src/merchant-payment-connection-store.ts's
 * header for the full technical disclosure.
 */

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Badge } from "@counter/ui";
import { CreditCard, ArrowRight, CheckCircle2 } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";
import { getApiClient } from "@/hooks/use-api";
import { getStoredMerchantId } from "@/lib/merchant-application-storage";

const PERMISSIONS_NOT_READY_MESSAGE =
  "Your session doesn't have merchant permissions yet. This step needs a one-time Auth0 " +
  "configuration change on Counter's side (not yet done) before it can save — this is a known, " +
  "tracked gap, not something wrong with what you entered.";

export default function PaymentConnectPage() {
  const router = useRouter();
  const [merchantId, setMerchantId] = useState<string | undefined>(undefined);
  const [checkedStorage, setCheckedStorage] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connectedKeyId, setConnectedKeyId] = useState<string | undefined>(undefined);

  const [keyId, setKeyId] = useState("");
  const [keySecret, setKeySecret] = useState("");
  const [connecting, setConnecting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const id = getStoredMerchantId();
    setMerchantId(id);
    setCheckedStorage(true);
    if (id !== undefined) {
      void loadStatus(id);
    }
  }, []);

  async function loadStatus(id: string) {
    const result = await getApiClient().getRazorpayConnection(id);
    if (result.ok && result.data.connected) {
      setConnected(true);
      setConnectedKeyId(result.data.keyId);
    }
  }

  async function handleConnect(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (merchantId === undefined) return;

    if (keyId.trim().length === 0 || keySecret.trim().length === 0) {
      setError("Enter both your Razorpay key ID and key secret.");
      return;
    }

    setConnecting(true);
    const result = await getApiClient().connectRazorpay(merchantId, {
      keyId: keyId.trim(),
      keySecret: keySecret.trim(),
    });
    setConnecting(false);

    if (!result.ok) {
      setError(
        result.error.code === "UNAUTHORIZED" || result.error.code === "FORBIDDEN"
          ? PERMISSIONS_NOT_READY_MESSAGE
          : result.error.message,
      );
      return;
    }
    setConnected(true);
    setConnectedKeyId(result.data.keyId);
    setKeySecret("");
  }

  if (checkedStorage && merchantId === undefined) {
    return (
      <PageWrapper>
        <Card>
          <CardContent className="p-6 text-sm text-[var(--foreground-secondary)]">
            No application found yet.{" "}
            <Link href="/invite" className="text-[var(--brand-orange)] underline">
              Start from the beginning
            </Link>
            .
          </CardContent>
        </Card>
      </PageWrapper>
    );
  }

  return (
    <PageWrapper>
      <div className="space-y-6">
        <div>
          <h1 className="text-2xl font-bold text-[var(--foreground)]">Connect payments</h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Connect your own Razorpay account so Counter can confirm you can accept payments.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              <div className="flex items-center gap-2">
                <CreditCard className="h-4 w-4 text-[var(--brand-orange)]" />
                Your Razorpay account
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {connected ? (
              <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-green-50 p-4">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <div>
                  <p className="text-sm font-medium text-[var(--foreground)]">Connected</p>
                  {connectedKeyId && (
                    <p className="text-xs text-[var(--foreground-muted)]">Key: {connectedKeyId}</p>
                  )}
                </div>
                <Badge variant="success" className="ml-auto">
                  Verified
                </Badge>
              </div>
            ) : (
              <form className="space-y-3" onSubmit={(event) => void handleConnect(event)}>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-[var(--foreground)]" htmlFor="keyId">
                    Razorpay key ID
                  </label>
                  <Input
                    id="keyId"
                    value={keyId}
                    onChange={(event) => setKeyId(event.target.value)}
                    placeholder="rzp_test_xxxxxxxxxxxx"
                  />
                </div>
                <div className="space-y-1.5">
                  <label
                    className="text-sm font-medium text-[var(--foreground)]"
                    htmlFor="keySecret"
                  >
                    Razorpay key secret
                  </label>
                  <Input
                    id="keySecret"
                    type="password"
                    value={keySecret}
                    onChange={(event) => setKeySecret(event.target.value)}
                    placeholder="Your key secret"
                  />
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <Button type="submit" disabled={connecting}>
                  {connecting ? "Verifying…" : "Verify and connect"}
                </Button>
              </form>
            )}
            <p className="text-xs text-[var(--foreground-muted)]">
              We only use these to confirm the account is real and working. Real transactions
              don&apos;t run through these credentials yet — Counter still handles payment
              processing centrally while per-merchant billing is being built.
            </p>
          </CardContent>
        </Card>

        <Button
          variant={connected ? "default" : "outline"}
          onClick={() => router.push("/invite/readiness")}
        >
          Continue
          <ArrowRight className="ml-2 h-3.5 w-3.5" />
        </Button>
      </div>
    </PageWrapper>
  );
}
