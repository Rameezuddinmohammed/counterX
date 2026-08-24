/**
 * Dashboard overview linking to each section with summary counts.
 * Includes merchant operations, telemetry, and recovery capabilities.
 */
export default function OperationsConsoleDashboard() {
  const sections = [
    { href: "/fleet", title: "Fleet Health", description: "Dependency health status grid" },
    {
      href: "/incidents",
      title: "Incidents",
      description: "Active incidents with severity and scope",
    },
    {
      href: "/queues",
      title: "Queues & Dead Letters",
      description: "Job queue depth and failed messages",
    },
    {
      href: "/kill-switches",
      title: "Kill Switches",
      description: "Server-side feature flags by scope",
    },
    {
      href: "/support",
      title: "Support Sessions",
      description: "Active grants with expiry and purpose",
    },
    { href: "/adapters", title: "Adapter Releases", description: "Connector versions and health" },
    {
      href: "/merchant-ops",
      title: "Merchant Operations",
      description: "Merchant-scoped transactions, refunds, voids, and suspensions",
    },
    {
      href: "/telemetry",
      title: "Telemetry Dashboard",
      description: "Transaction success rates, provider latency, queue depth metrics",
    },
    {
      href: "/recovery",
      title: "Recovery Commands",
      description: "Replay, rotation, backup/restore, drain, and force reconcile",
    },
    {
      href: "/runbooks",
      title: "Runbooks",
      description: "Structured guides for outage, backlog, crash, offboarding, and rotation",
    },
    {
      href: "/credential-scan",
      title: "Credential Scanner",
      description: "Scan storage and telemetry for forbidden credential patterns",
    },
  ] as const;

  return (
    <main>
      <h1>Counter Operations Console</h1>
      <p>Platform operator dashboard. Select a section to view details.</p>
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fill, minmax(250px, 1fr))",
          gap: "1rem",
          marginTop: "1rem",
        }}
      >
        {sections.map((section) => (
          <a
            key={section.href}
            href={section.href}
            style={{
              display: "block",
              padding: "1rem",
              border: "1px solid #e0e0e0",
              borderRadius: "4px",
              textDecoration: "none",
              color: "inherit",
            }}
          >
            <h2 style={{ margin: "0 0 0.5rem 0", fontSize: "1.1rem" }}>{section.title}</h2>
            <p style={{ margin: 0, color: "#666" }}>{section.description}</p>
          </a>
        ))}
      </div>
    </main>
  );
}
