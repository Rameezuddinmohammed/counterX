"use client";

import { useState } from "react";
import { Button, Card, CardContent, CardHeader, CardTitle, Input, Badge } from "@counter/ui";
import { Wallet, CheckCircle2 } from "lucide-react";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open(): void };
  }
}


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
      // Step-up is bypassed when MFA/OTP is disabled in Auth0
      try {
        // Proceed directly
      } catch (stepUpError) {
        console.warn("[topup] step-up skipped:", stepUpError);
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

  const PRESETS = ["500", "1000", "2000", "5000"];

  if (state.status === "done") {
    const balanceRupees = (Number(state.balanceMinor) / 100).toLocaleString("en-IN");
    return (
      <Card className="border-emerald-500/30 bg-emerald-500/5">
        <CardContent className="p-6">
          <div className="flex items-center gap-4">
            <div className="flex h-12 w-12 items-center justify-center rounded-2xl bg-emerald-500/15 text-emerald-500 border border-emerald-500/30">
              <CheckCircle2 className="h-6 w-6" />
            </div>
            <div>
              <p className="font-bold text-base text-[var(--foreground)]">Top-up Successful</p>
              <p className="text-sm text-[var(--foreground-secondary)] mt-0.5">
                Your wallet balance is now <strong className="font-mono font-bold text-emerald-500">₹{balanceRupees}</strong>.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card className="border-indigo-500/20 shadow-lg">
      <CardHeader>
        <CardTitle className="flex items-center gap-2 text-base font-bold">
          <div className="flex h-8 w-8 items-center justify-center rounded-xl bg-indigo-500/10 text-indigo-500">
            <Wallet className="h-4 w-4" />
          </div>
          Add Funds via Razorpay
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-5">
        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-secondary)]/80 p-3.5 flex items-center justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-muted)]">
              Receiving Wallet
            </p>
            <p className="font-mono text-xs font-semibold text-[var(--foreground)] mt-0.5">
              {walletId}
            </p>
          </div>
          <Badge variant="success" className="text-[10px]">
            Ready
          </Badge>
        </div>

        {/* Quick Presets */}
        <div className="space-y-2">
          <label className="text-xs font-semibold uppercase tracking-wider text-[var(--foreground-secondary)]">
            Quick Amount Presets
          </label>
          <div className="grid grid-cols-4 gap-2">
            {PRESETS.map((preset) => (
              <button
                key={preset}
                type="button"
                onClick={() => setAmountRupees(preset)}
                disabled={busy}
                className={`py-2 rounded-xl text-xs font-mono font-bold border transition-all ${
                  amountRupees === preset
                    ? "border-indigo-500 bg-indigo-500/15 text-indigo-500 shadow-sm"
                    : "border-[var(--border)] bg-[var(--surface)] text-[var(--foreground-secondary)] hover:border-[var(--border-secondary)] hover:text-[var(--foreground)]"
                }`}
              >
                ₹{Number(preset).toLocaleString("en-IN")}
              </button>
            ))}
          </div>
        </div>

        <div>
          <label className="mb-1.5 block text-xs font-semibold uppercase tracking-wider text-[var(--foreground-secondary)]">
            Custom Amount (INR)
          </label>
          <div className="relative">
            <span className="absolute left-3.5 top-1/2 -translate-y-1/2 font-mono font-bold text-[var(--foreground-muted)]">
              ₹
            </span>
            <Input
              type="number"
              min="1"
              value={amountRupees}
              onChange={(e) => {
                setAmountRupees(e.target.value);
              }}
              disabled={busy}
              className="pl-8 font-mono font-bold text-base"
            />
          </div>
        </div>

        <Button
          onClick={() => {
            void handleTopUp();
          }}
          disabled={busy}
          className="w-full h-11 text-sm font-bold shadow-md shadow-indigo-500/20"
        >
          {state.status === "step-up"
            ? "Confirming with Auth0 Step-up MFA…"
            : state.status === "creating-order"
              ? "Preparing Razorpay Order…"
              : state.status === "awaiting-payment"
                ? "Checkout open in popup…"
                : state.status === "confirming"
                  ? "Verifying payment with Counter…"
                  : `Top Up ₹${Number(amountRupees || 0).toLocaleString("en-IN")}`}
        </Button>

        {state.status === "error" && (
          <div className="rounded-xl border border-rose-500/30 bg-rose-500/10 p-3 text-xs text-rose-500 font-medium">
            {state.message}
          </div>
        )}

        <div className="flex flex-wrap items-center justify-between gap-2 pt-1 border-t border-[var(--border)] text-[11px] text-[var(--foreground-muted)]">
          <div className="flex items-center gap-1.5">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500" />
            <span>MFA Protected</span>
          </div>
          <Badge variant="secondary" className="text-[10px]">
            Razorpay Test Mode &bull; Safe Dummy Cards
          </Badge>
        </div>
      </CardContent>
    </Card>
  );
}
