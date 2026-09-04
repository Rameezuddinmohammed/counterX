"use client";

import { useState } from "react";
import { mfa } from "@auth0/nextjs-auth0/client";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Badge } from "@counter/ui";
import { Wallet, CheckCircle2 } from "lucide-react";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open(): void };
  }
}

const API_AUDIENCE = "https://api.counter.dev";
// Deliberately NOT passing an explicit `scope` to challengeWithPopup — same
// reasoning as connect-panel.tsx's identical comment: omitting it keeps the
// popup on the app's global scope config, which is what getAccessToken()'s
// post-popup cache lookup searches for too.

interface BeginTopupResponse {
  readonly referenceId: string;
  readonly checkout: {
    readonly razorpayOrderId: string;
    readonly razorpayKeyId: string;
    readonly amountMinor: string;
    readonly currency: string;
  };
}

function loadRazorpayCheckout(): Promise<void> {
  if (window.Razorpay !== undefined) {
    return Promise.resolve();
  }
  return new Promise((resolve, reject) => {
    const script = document.createElement("script");
    script.src = "https://checkout.razorpay.com/v1/checkout.js";
    script.onload = () => {
      resolve();
    };
    script.onerror = () => {
      reject(new Error("Could not load Razorpay's checkout widget."));
    };
    document.body.appendChild(script);
  });
}

type State =
  | { status: "idle" }
  | { status: "step-up" }
  | { status: "creating-order" }
  | { status: "awaiting-payment" }
  | { status: "confirming" }
  | { status: "done"; balanceMinor: string }
  | { status: "error"; message: string };

export function TopupPanel({ walletId }: { walletId: string }) {
  const [state, setState] = useState<State>({ status: "idle" });
  const [amountRupees, setAmountRupees] = useState("2000");

  const busy = state.status !== "idle" && state.status !== "error" && state.status !== "done";

  async function handleTopUp() {
    const amountMinor = Math.round(Number(amountRupees) * 100);
    if (!Number.isFinite(amountMinor) || amountMinor <= 0) {
      setState({ status: "error", message: "Enter a valid amount greater than zero." });
      return;
    }

    try {
      // Step-up first: this whole flow is gated server-side by
      // identity.scope.manage, which requires step-up assurance — same bar
      // as connect-panel.tsx's mandate flow.
      setState({ status: "step-up" });
      try {
        await mfa.challengeWithPopup({ audience: API_AUDIENCE });
      } catch (stepUpError) {
        console.error("[topup] step-up failed:", stepUpError);
        const detail = stepUpError instanceof Error ? stepUpError.message : String(stepUpError);
        setState({ status: "error", message: `Verification step failed: ${detail}` });
        return;
      }

      setState({ status: "creating-order" });
      await loadRazorpayCheckout();

      const beginResponse = await fetch("/api/wallet/topup", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ amountMinor: String(amountMinor) }),
      });
      if (!beginResponse.ok) {
        const errorBody = (await beginResponse.json().catch(() => undefined)) as
          | { error?: { message?: string } }
          | undefined;
        setState({
          status: "error",
          message: errorBody?.error?.message ?? "Could not start the top-up.",
        });
        return;
      }
      const begin = (await beginResponse.json()) as BeginTopupResponse;

      if (window.Razorpay === undefined) {
        setState({ status: "error", message: "Razorpay's checkout widget did not load." });
        return;
      }

      setState({ status: "awaiting-payment" });
      const razorpay = new window.Razorpay({
        key: begin.checkout.razorpayKeyId,
        order_id: begin.checkout.razorpayOrderId,
        amount: begin.checkout.amountMinor,
        currency: begin.checkout.currency,
        name: "Counter",
        description: "Add funds to your Counter wallet",
        handler: (response: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          void (async () => {
            setState({ status: "confirming" });
            const confirmResponse = await fetch("/api/wallet/topup/confirm", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              }),
            });
            if (!confirmResponse.ok) {
              setState({
                status: "error",
                message: "Payment completed, but we couldn't confirm the top-up. Contact support.",
              });
              return;
            }
            const confirmed = (await confirmResponse.json()) as { balanceMinor: string };
            setState({ status: "done", balanceMinor: confirmed.balanceMinor });
          })();
        },
        modal: {
          ondismiss: () => {
            setState({ status: "idle" });
          },
        },
      });
      razorpay.open();
    } catch (unexpectedError) {
      console.error("[topup] unexpected failure:", unexpectedError);
      const detail =
        unexpectedError instanceof Error ? unexpectedError.message : String(unexpectedError);
      setState({ status: "error", message: `Unexpected error: ${detail}` });
    }
  }

  if (state.status === "done") {
    const balanceRupees = (Number(state.balanceMinor) / 100).toLocaleString("en-IN");
    return (
      <Card className="border-green-500/30">
        <CardContent className="p-6">
          <div className="flex items-center gap-3">
            <CheckCircle2 className="h-6 w-6 text-green-500" />
            <div>
              <p className="font-semibold text-[var(--foreground)]">Funds added</p>
              <p className="text-sm text-[var(--foreground-muted)]">
                Your wallet balance is now ₹{balanceRupees}.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base">
          <Wallet className="h-4 w-4 text-[var(--brand-orange)]" />
          Add funds via Razorpay
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <p style={{ margin: 0, color: "var(--muted)" }}>Your wallet</p>
        <code>{walletId}</code>
        <div>
          <label className="mb-1 block text-sm font-medium text-[var(--foreground)]">
            Amount (₹)
          </label>
          <Input
            type="number"
            min="1"
            value={amountRupees}
            onChange={(e) => {
              setAmountRupees(e.target.value);
            }}
            disabled={busy}
          />
        </div>
        <Button
          onClick={() => {
            void handleTopUp();
          }}
          disabled={busy}
          className="w-full"
        >
          {state.status === "step-up"
            ? "Confirming it's really you…"
            : state.status === "creating-order"
              ? "Preparing checkout…"
              : state.status === "awaiting-payment"
                ? "Waiting for payment…"
                : state.status === "confirming"
                  ? "Confirming…"
                  : "Add funds"}
        </Button>
        {state.status === "error" && <p className="text-sm text-red-500">{state.message}</p>}
        <Badge variant="secondary" className="text-[10px]">
          Razorpay&apos;s real test-mode checkout — no real money moves
        </Badge>
      </CardContent>
    </Card>
  );
}
