import type { ReactNode } from "react";

export const metadata = {
  title: "Counter Merchant Console",
  description: "Counter Merchant configuration and monitoring console.",
};

const NAV_ITEMS = [
  { href: "/", label: "Dashboard" },
  { href: "/invite", label: "Invitation & Lifecycle" },
  { href: "/shopify", label: "Shopify Setup" },
  { href: "/mapping", label: "Mapping Preview" },
  { href: "/policy", label: "Policy Simulation" },
  { href: "/razorpay", label: "Razorpay Status" },
  { href: "/readiness", label: "Readiness Checks" },
  { href: "/manifest", label: "Manifest Activation" },
  { href: "/transactions", label: "Transaction Timeline" },
  { href: "/findings", label: "Findings & Reconciliation" },
  { href: "/killswitch", label: "Kill Switches" },
  { href: "/audit", label: "Audit & Export" },
  { href: "/suspension", label: "Suspension & Offboarding" },
] as const;

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="en">
      <body style={{ margin: 0, fontFamily: "system-ui, -apple-system, sans-serif" }}>
        <div style={{ display: "flex", minHeight: "100vh" }}>
          {/* Sidebar Navigation */}
          <nav
            style={{
              width: "260px",
              backgroundColor: "#1a1a2e",
              color: "#e0e0e0",
              padding: "16px 0",
              flexShrink: 0,
              overflowY: "auto",
            }}
          >
            <div style={{ padding: "0 16px 16px", borderBottom: "1px solid #333" }}>
              <h1 style={{ fontSize: "16px", margin: "0 0 4px", color: "#fff" }}>
                Counter Merchant Console
              </h1>
              <span
                style={{
                  fontSize: "11px",
                  backgroundColor: "#f59e0b",
                  color: "#000",
                  padding: "2px 6px",
                  borderRadius: "3px",
                  fontWeight: 600,
                }}
              >
                PILOT
              </span>
            </div>
            <ul style={{ listStyle: "none", margin: "8px 0", padding: 0 }}>
              {NAV_ITEMS.map((item) => (
                <li key={item.href}>
                  <a
                    href={item.href}
                    style={{
                      display: "block",
                      padding: "10px 16px",
                      color: "#ccc",
                      textDecoration: "none",
                      fontSize: "14px",
                      borderLeft: "3px solid transparent",
                    }}
                  >
                    {item.label}
                  </a>
                </li>
              ))}
            </ul>
          </nav>

          {/* Main Content */}
          <main style={{ flex: 1, padding: "24px 32px", backgroundColor: "#fafafa" }}>
            {children}
          </main>
        </div>
      </body>
    </html>
  );
}
