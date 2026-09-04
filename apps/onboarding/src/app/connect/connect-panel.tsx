"use client";

import { useState } from "react";
import { mfa } from "@auth0/nextjs-auth0/client";

const API_AUDIENCE = "https://api.counter.dev";

export function ConnectPanel({ walletId }: { walletId: string }) {
  const [state, setState] = useState<
    | { status: "idle" }
    | { status: "step-up"; label: string }
    | { status: "loading" }
    | { status: "ready"; command: string; expiresAt: string }
    | { status: "error"; message: string }
  >({ status: "idle" });

  async function handleGenerate() {
    // Minting a setup token is gated by identity.agent_key.manage, which
    // requires step-up assurance (packages/authorization/src/assurance.ts) —
    // a plain logged-in session is never enough. Trigger Auth0's step-up
    // challenge (Universal Login popup) BEFORE calling the API, rather than
    // reacting to a 403: our own backend enforces this via a custom claim
    // Auth0 itself has no native concept of, so getAccessToken() would
    // otherwise happily return a non-elevated token without ever throwing.
    // See ~/.claude/plans/the-mandate-pivot.md Phase 1.2.
    setState({ status: "step-up", label: "Confirming it's really you…" });
    try {
      await mfa.challengeWithPopup({ audience: API_AUDIENCE });
    } catch {
      setState({
        status: "error",
        message:
          "Could not complete the extra verification step. Please try again, and make sure pop-ups are allowed for this site.",
      });
      return;
    }

    setState({ status: "loading" });
    try {
      const response = await fetch("/api/setup-token", { method: "POST" });
      if (!response.ok) {
        const body = (await response.json().catch(() => undefined)) as
          | { error?: { message?: string } }
          | undefined;
        setState({
          status: "error",
          message: body?.error?.message ?? "Could not generate a setup token.",
        });
        return;
      }
      const { setupToken, expiresAt } = (await response.json()) as {
        setupToken: string;
        expiresAt: string;
      };
      const command = `node register-agent-self-serve.mjs --wallet ${walletId} --setup-token ${setupToken}`;
      setState({ status: "ready", command, expiresAt });
    } catch {
      setState({ status: "error", message: "Network error — please try again." });
    }
  }

  return (
    <div className="panel">
      <p style={{ margin: 0, color: "var(--muted)" }}>Your wallet</p>
      <code>{walletId}</code>

      {state.status !== "ready" && (
        <div>
          <button
            className="button"
            onClick={() => {
              void handleGenerate();
            }}
            disabled={state.status === "loading" || state.status === "step-up"}
          >
            {state.status === "step-up"
              ? state.label
              : state.status === "loading"
                ? "Generating…"
                : "Generate connect command"}
          </button>
          {state.status === "error" && <p style={{ color: "#f87171" }}>{state.message}</p>}
        </div>
      )}

      {state.status === "ready" && (
        <div>
          <p style={{ color: "var(--muted)" }}>
            Run this on the machine where your AI tool lives. It generates a real signing key
            locally (never sent to Counter) and registers its public half against your wallet. This
            token expires at {new Date(state.expiresAt).toLocaleTimeString()} and can only be used
            once.
          </p>
          <pre>{state.command}</pre>
        </div>
      )}
    </div>
  );
}
