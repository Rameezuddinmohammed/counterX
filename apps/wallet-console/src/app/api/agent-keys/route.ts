/**
 * Thin server-side proxy for control-plane-api's
 * POST /control/v1/wallet-users/agent-keys — deliberately UNAUTHENTICATED
 * upstream (the setup token IS the proof of identity; see that route's own
 * header). This proxy exists purely to avoid needing CORS support on
 * control-plane-api for a direct browser-to-Fly.io call; it forwards the
 * body as-is and adds no session/credential of its own.
 *
 * Used by connect-panel.tsx to register the disposable "consent key"
 * generated in the browser — see mandate-service.ts's header (Mandate
 * Pivot Phase 1.3) for why that key is separate from the buyer's actual AI
 * agent's own long-lived operating key.
 */
import { NextResponse } from "next/server";

const CONTROL_PLANE_URL =
  process.env["CONTROL_PLANE_URL"] ?? "https://counter-control-plane-api.fly.dev";

export async function POST(request: Request) {
  const body = (await request.json().catch(() => undefined)) as
    | { setupToken?: unknown; keyId?: unknown; publicKeyBase64Url?: unknown }
    | undefined;

  const upstream = await fetch(`${CONTROL_PLANE_URL}/control/v1/wallet-users/agent-keys`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body ?? {}),
  });

  const result = await upstream.json().catch(() => ({}));
  return NextResponse.json(result, { status: upstream.status });
}
