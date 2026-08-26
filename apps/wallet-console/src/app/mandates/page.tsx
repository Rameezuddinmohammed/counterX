/**
 * Mandate management page.
 */
export default function MandatesPage() {
  const mandates = [
    {
      id: "mnd-001",
      agent: "Agent Alpha",
      scope: "Purchase up to 25,000 INR",
      status: "active",
      issuedAt: "2025-01-02",
    },
    {
      id: "mnd-002",
      agent: "Agent Beta",
      scope: "Recurring subscriptions",
      status: "active",
      issuedAt: "2025-01-05",
    },
    {
      id: "mnd-003",
      agent: "Agent Gamma",
      scope: "Office supplies",
      status: "revoked",
      issuedAt: "2025-01-03",
    },
  ];

  return (
    <main>
      <h1>Mandates</h1>
      <p>
        Mandates delegate specific authority from the wallet principal to
        registered agents. Each mandate defines what an agent can do.
      </p>

      <section>
        <h2>Active Mandates</h2>
        <table>
          <thead>
            <tr>
              <th>Agent</th>
              <th>Scope</th>
              <th>Status</th>
              <th>Issued</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {mandates.map((m) => (
              <tr key={m.id}>
                <td>{m.agent}</td>
                <td>{m.scope}</td>
                <td>{m.status}</td>
                <td>{m.issuedAt}</td>
                <td>{m.status === "active" ? "Revoke" : "-"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Issue New Mandate</h2>
        <p>
          Creating a mandate requires consent attestation from the wallet
          principal (step-up authentication required).
        </p>
        <ul>
          <li>Select registered agent</li>
          <li>Define scope constraints</li>
          <li>Set validity period</li>
          <li>Provide consent attestation</li>
        </ul>
      </section>

      <section>
        <h2>Mandate Lifecycle</h2>
        <ul>
          <li>Active: agent can act within mandate scope</li>
          <li>Suspended: temporarily disabled</li>
          <li>Revoked: permanently terminated (monotonic)</li>
          <li>Expired: past validity period</li>
        </ul>
      </section>
    </main>
  );
}
