/**
 * Payment references management page.
 */
export default function ReferencesPage() {
  const references = [
    {
      id: "ref-001",
      environment: "counter_test",
      status: "active",
      createdAt: "2025-01-01",
      label: "Test Reference",
    },
  ];

  return (
    <main>
      <h1>Payment References</h1>
      <p>
        Manage payment authorization references that link your wallet to
        payment providers.
      </p>

      <section>
        <h2>Active References</h2>
        <table>
          <thead>
            <tr>
              <th>Label</th>
              <th>Environment</th>
              <th>Status</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {references.map((ref) => (
              <tr key={ref.id}>
                <td>{ref.label}</td>
                <td>{ref.environment}</td>
                <td>{ref.status}</td>
                <td>{ref.createdAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Add Payment Reference</h2>
        <p>
          Payment references require step-up authentication (substantial
          assurance) to create or modify.
        </p>
        <ul>
          <li>Counter Test references for pilot environment</li>
          <li>Production references require additional verification</li>
          <li>References are bound to specific environments</li>
        </ul>
      </section>

      <section>
        <h2>Security Notes</h2>
        <ul>
          <li>Payment reference changes are privileged operations</li>
          <li>All changes generate CTP evidence envelopes</li>
          <li>Revoked references cannot be reactivated</li>
        </ul>
      </section>
    </main>
  );
}
