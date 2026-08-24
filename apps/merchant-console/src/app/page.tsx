/**
 * Dashboard / Home page for the Counter Merchant Console.
 *
 * Shows a high-level overview of the merchant's current status
 * across all operational areas.
 */

export default function MerchantConsoleHomePage() {
  const cards = [
    { href: "/invite", title: "Invitation & Lifecycle", description: "Manage invitation status and lifecycle state", status: "Onboarding" },
    { href: "/shopify", title: "Shopify Setup", description: "Store connection and sync status", status: "Connected" },
    { href: "/mapping", title: "Mapping Preview", description: "Product catalog mapping progress", status: "38/47 mapped" },
    { href: "/policy", title: "Policy Simulation", description: "Rule evaluation and wallet authority", status: "Conditional" },
    { href: "/razorpay", title: "Razorpay Status", description: "Payment gateway configuration", status: "Test Mode" },
    { href: "/readiness", title: "Readiness Checks", description: "Activation readiness assessment", status: "1 Blocking" },
    { href: "/manifest", title: "Manifest Activation", description: "Capability manifest management", status: "Pending" },
    { href: "/transactions", title: "Transaction Timeline", description: "Payment transaction history", status: "3 transactions" },
    { href: "/findings", title: "Findings", description: "Reconciliation findings and compensation", status: "2 open" },
    { href: "/killswitch", title: "Kill Switches", description: "Emergency operation controls", status: "1 active" },
    { href: "/audit", title: "Audit & Export", description: "Immutable audit trail", status: "6 entries" },
    { href: "/suspension", title: "Suspension", description: "Suspension and offboarding controls", status: "Active" },
  ];

  return (
    <div>
      <h1>Counter Merchant Console</h1>
      <p style={{ color: "#666", marginBottom: "24px" }}>
        Pilot merchant configuration and monitoring dashboard. All operations are in test mode with INR only.
      </p>

      {/* Status Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fill, minmax(280px, 1fr))", gap: "16px" }}>
        {cards.map((card) => (
          <a
            key={card.href}
            href={card.href}
            style={{
              display: "block",
              padding: "20px",
              border: "1px solid #e5e7eb",
              borderRadius: "8px",
              textDecoration: "none",
              color: "inherit",
              backgroundColor: "#fff",
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
              <h3 style={{ margin: "0 0 8px", fontSize: "15px", color: "#111" }}>{card.title}</h3>
              <span style={{ fontSize: "11px", padding: "3px 8px", borderRadius: "10px", backgroundColor: "#f3f4f6", color: "#374151", whiteSpace: "nowrap" }}>
                {card.status}
              </span>
            </div>
            <p style={{ margin: 0, fontSize: "13px", color: "#6b7280" }}>{card.description}</p>
          </a>
        ))}
      </div>
    </div>
  );
}
