import { auth0 } from "@/lib/auth0";
import { decodeIdTokenClaims } from "@/lib/id-token-claims";
import { ConnectPanel } from "./connect-panel";

const NAMESPACE = "https://counter.dev/";

// apps/remote-mcp is the hosted, Vault-backed MCP connector — a buyer's AI
// tool talks to this URL directly over OAuth (the tool's own login popup),
// so no local key is ever generated or run. Same env-var-with-fallback
// convention as CONTROL_PLANE_URL in ../api/setup-token/route.ts.
const REMOTE_MCP_URL = process.env["REMOTE_MCP_URL"] ?? "https://counter-remote-mcp.fly.dev";

// Same env-var-with-fallback convention as REMOTE_MCP_URL above. This page
// never linked anywhere else in the product — a new signup had a wallet and
// an MCP connector but no way to find where to fund it or manage it
// afterward. wallet-console is that place.
const WALLET_CONSOLE_URL = process.env["WALLET_CONSOLE_URL"] ?? "https://wallet-console.vercel.app";

export default async function ConnectPage() {
  const session = await auth0.getSession();
  // proxy.ts already redirects unauthenticated requests to /auth/login before
  // this ever renders; session is non-null here except in a race with logout.
  if (session === null) {
    return null;
  }

  const claims = decodeIdTokenClaims(session.tokenSet.idToken);
  const scope = claims[`${NAMESPACE}scope`] as { kind?: string; walletId?: string } | undefined;
  const walletId = scope?.walletId;

  return (
    <main>
      <span className="badge">TEST MODE</span>
      <h1>Connect your AI</h1>
      <p className="lede">
        You&apos;re signed in as {session.user.email ?? session.user.name ?? session.user.sub}.
        {walletId
          ? " Connect an AI tool to your wallet below."
          : " We couldn't find your wallet yet — try logging out and back in."}
      </p>
      {walletId !== undefined && (
        <>
          <ConnectPanel walletId={walletId} remoteMcpUrl={`${REMOTE_MCP_URL}/mcp`} />
          <div className="panel">
            <p style={{ margin: 0, color: "var(--muted)" }}>Next: fund your wallet</p>
            <p style={{ color: "var(--muted)" }}>
              Add money via Razorpay test mode and manage mandates, transactions, and devices from
              your wallet dashboard.
            </p>
            <a className="button" href={WALLET_CONSOLE_URL}>
              Go to your wallet dashboard →
            </a>
          </div>
        </>
      )}
      <p style={{ marginTop: "2rem" }}>
        <a href="/auth/logout" style={{ color: "var(--muted)" }}>
          Log out
        </a>
      </p>
    </main>
  );
}
