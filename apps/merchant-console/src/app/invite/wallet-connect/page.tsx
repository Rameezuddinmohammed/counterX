"use client";

/**
 * Hackathon-scoped onboarding step: "where do I receive crypto payments."
 *
 * SCOPE BOUNDARY, disclosed plainly to the merchant below too: this only
 * checks that the address is *well-formed* (a real Solana address decode,
 * not a fake regex) — it does NOT verify the address exists on-chain, is
 * funded, or is owned by whoever enters it. There is no Solana connector
 * package in this repo yet to check that against. See
 * apps/control-plane-api/src/merchant-wallet-connection-store.ts's header
 * for the full technical disclosure.
 *
 * This is SEPARATE from the Razorpay connection at /invite/payment-connect
 * — that step is for fiat payments via Counter's own gateway integration;
 * this step is for receiving crypto payments (Solana devnet, for this
 * hackathon/beta) directly to a merchant-owned wallet.
 */

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import { Card, CardContent, CardHeader, CardTitle, Button, Input, Badge } from "@counter/ui";
import { Wallet, ArrowRight, CheckCircle2 } from "lucide-react";
import { PageWrapper } from "@/components/page-wrapper";
import { getApiClient } from "@/hooks/use-api";
import { getStoredMerchantId } from "@/lib/merchant-application-storage";

const PERMISSIONS_NOT_READY_MESSAGE =
  "Your session doesn't have merchant permissions yet. This step needs a one-time Auth0 " +
  "configuration change on Counter's side (not yet done) before it can save — this is a known, " +
  "tracked gap, not something wrong with what you entered.";

export default function WalletConnectPage() {
  const router = useRouter();
  const [merchantId, setMerchantId] = useState<string | undefined>(undefined);
  const [checkedStorage, setCheckedStorage] = useState(false);
  const [connected, setConnected] = useState(false);
  const [connectedAddress, setConnectedAddress] = useState<string | undefined>(undefined);

  const [address, setAddress] = useState("");
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
    const result = await getApiClient().getWalletConnection(id);
    if (result.ok && result.data.connected) {
      setConnected(true);
      setConnectedAddress(result.data.address);
    }
  }

  async function handleConnect(event: FormEvent) {
    event.preventDefault();
    setError(null);
    if (merchantId === undefined) return;

    if (address.trim().length === 0) {
      setError("Enter your Solana devnet wallet address.");
      return;
    }

    setConnecting(true);
    const result = await getApiClient().connectWallet(merchantId, {
      chain: "solana-devnet",
      address: address.trim(),
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
    setConnectedAddress(result.data.address);
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
          <h1 className="text-2xl font-bold text-[var(--foreground)]">
            Connect a crypto wallet
          </h1>
          <p className="mt-1 text-[var(--foreground-secondary)]">
            Add the Solana devnet address where you&apos;ll receive crypto payments during the
            hackathon/beta. This is separate from the Razorpay connection above, which handles
            fiat payments.
          </p>
        </div>

        <Card>
          <CardHeader>
            <CardTitle>
              <div className="flex items-center gap-2">
                <Wallet className="h-4 w-4 text-[var(--brand-orange)]" />
                Solana devnet address
              </div>
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {connected ? (
              <div className="flex items-center gap-3 rounded-lg border border-[var(--border)] bg-green-50 p-4">
                <CheckCircle2 className="h-5 w-5 text-green-600" />
                <div>
                  <p className="text-sm font-medium text-[var(--foreground)]">Connected</p>
                  {connectedAddress && (
                    <p className="text-xs text-[var(--foreground-muted)] break-all">
                      Address: {connectedAddress}
                    </p>
                  )}
                </div>
                <Badge variant="success" className="ml-auto">
                  Format checked
                </Badge>
              </div>
            ) : (
              <form className="space-y-3" onSubmit={(event) => void handleConnect(event)}>
                <div className="space-y-1.5">
                  <label className="text-sm font-medium text-[var(--foreground)]" htmlFor="address">
                    Solana devnet address
                  </label>
                  <Input
                    id="address"
                    value={address}
                    onChange={(event) => setAddress(event.target.value)}
                    placeholder="e.g. 7cVfgArCheMR6Cw96FUvfagAQFRi9zHhqGqPCsMxHfLb"
                  />
                </div>
                {error && <p className="text-sm text-red-600">{error}</p>}
                <Button type="submit" disabled={connecting}>
                  {connecting ? "Checking…" : "Connect wallet"}
                </Button>
              </form>
            )}
            <p className="text-xs text-[var(--foreground-muted)]">
              We only check that this address is a well-formed Solana address (the right shape
              and length) — we do not yet verify on-chain that it exists or that you own it.
              That real verification is planned follow-up work, not done in this pass.
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
