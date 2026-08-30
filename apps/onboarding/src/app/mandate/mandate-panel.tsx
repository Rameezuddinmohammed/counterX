"use client";

import { useState } from "react";

declare global {
  interface Window {
    Razorpay?: new (options: Record<string, unknown>) => { open(): void };
  }
}

interface BeginRegistrationResponse {
  readonly referenceId: string;
  readonly checkout: {
    readonly razorpayOrderId: string;
    readonly razorpayKeyId: string;
    readonly razorpayCustomerId: string;
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

export function MandatePanel({
  walletId,
  contactEmail,
}: {
  walletId: string;
  contactEmail: string;
}) {
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "loading" }
    | { status: "active"; referenceId: string; ceilingRupees: string }
    | { status: "error"; message: string }
  >({ status: "idle" });
  const [ceilingRupees, setCeilingRupees] = useState("2000");
  const [contactPhone, setContactPhone] = useState("");

  async function handleAuthorize() {
    if (contactPhone.trim().length === 0) {
      setState({ status: "error", message: "Enter the phone number linked to your UPI app." });
      return;
    }
    setState({ status: "loading" });
    try {
      await loadRazorpayCheckout();

      const validUntil = new Date();
      validUntil.setFullYear(validUntil.getFullYear() + 1);
      const ceilingMinor = String(Math.round(Number(ceilingRupees) * 100));

      const beginResponse = await fetch("/api/recurring-mandate", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          contactName: contactEmail.split("@")[0] ?? "Counter wallet owner",
          contactEmail,
          contactPhone,
          ceilingMinor,
          validUntil: validUntil.toISOString(),
        }),
      });
      if (!beginResponse.ok) {
        const body = (await beginResponse.json().catch(() => undefined)) as
          | { error?: { message?: string } }
          | undefined;
        setState({
          status: "error",
          message: body?.error?.message ?? "Could not begin mandate registration.",
        });
        return;
      }
      const begin = (await beginResponse.json()) as BeginRegistrationResponse;

      if (window.Razorpay === undefined) {
        setState({ status: "error", message: "Razorpay's checkout widget did not load." });
        return;
      }

      const razorpay = new window.Razorpay({
        key: begin.checkout.razorpayKeyId,
        order_id: begin.checkout.razorpayOrderId,
        amount: begin.checkout.amountMinor,
        currency: begin.checkout.currency,
        name: "Counter",
        description: "Authorize recurring purchases for your AI",
        recurring: 1,
        prefill: { email: contactEmail, contact: contactPhone },
        handler: (response: {
          razorpay_order_id: string;
          razorpay_payment_id: string;
          razorpay_signature: string;
        }) => {
          void (async () => {
            const confirmResponse = await fetch("/api/recurring-mandate/confirm", {
              method: "POST",
              headers: { "content-type": "application/json" },
              body: JSON.stringify({
                referenceId: begin.referenceId,
                razorpayOrderId: response.razorpay_order_id,
                razorpayPaymentId: response.razorpay_payment_id,
                razorpaySignature: response.razorpay_signature,
              }),
            });
            if (!confirmResponse.ok) {
              setState({
                status: "error",
                message: "Payment completed, but we couldn't confirm the mandate. Contact support.",
              });
              return;
            }
            setState({ status: "active", referenceId: begin.referenceId, ceilingRupees });
          })();
        },
        modal: {
          ondismiss: () => {
            setState({ status: "idle" });
          },
        },
      });
      razorpay.open();
    } catch {
      setState({ status: "error", message: "Network error — please try again." });
    }
  }

  return (
    <div className="panel">
      <p style={{ margin: 0, color: "var(--muted)" }}>Your wallet</p>
      <code>{walletId}</code>

      {state.status === "active" ? (
        <div style={{ marginTop: "1rem" }}>
          <p>
            Active — your AI may draw up to ₹{state.ceilingRupees} per charge against this
            authorization until you revoke it.
          </p>
          <code style={{ fontSize: "0.8rem", color: "var(--muted)" }}>{state.referenceId}</code>
        </div>
      ) : (
        <div style={{ marginTop: "1rem" }}>
          <label style={{ display: "block", marginBottom: "0.5rem" }}>
            Maximum per charge (₹)
            <input
              type="number"
              min="1"
              value={ceilingRupees}
              onChange={(e) => {
                setCeilingRupees(e.target.value);
              }}
              style={{ display: "block", marginTop: "0.25rem", width: "100%" }}
            />
          </label>
          <label style={{ display: "block", marginBottom: "0.5rem" }}>
            Phone number linked to your UPI app
            <input
              type="tel"
              placeholder="+91XXXXXXXXXX"
              value={contactPhone}
              onChange={(e) => {
                setContactPhone(e.target.value);
              }}
              style={{ display: "block", marginTop: "0.25rem", width: "100%" }}
            />
          </label>
          <button
            className="button"
            onClick={() => {
              void handleAuthorize();
            }}
            disabled={state.status === "loading"}
          >
            {state.status === "loading" ? "Opening checkout…" : "Authorize with UPI"}
          </button>
          {state.status === "error" && <p style={{ color: "#f87171" }}>{state.message}</p>}
        </div>
      )}
    </div>
  );
}
