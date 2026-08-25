/**
 * Time triggers management page.
 */
export default function TriggersPage() {
  const triggers = [
    {
      id: "trg-001",
      name: "Monthly subscription",
      schedule: "Cron: 0 9 1 * *",
      merchant: "CloudHost Pro",
      amount: "12,000 INR",
      status: "active",
      nextRun: "2025-02-01 09:00",
    },
    {
      id: "trg-002",
      name: "Weekly office supplies",
      schedule: "Interval: 7 days",
      merchant: "OfficeSupply Co",
      amount: "Up to 5,000 INR",
      status: "active",
      nextRun: "2025-01-22 10:00",
    },
  ];

  return (
    <main>
      <h1>Time Triggers</h1>
      <p>
        Configure automated purchase triggers that execute on a schedule
        within your buyer policy constraints.
      </p>

      <section>
        <h2>Active Triggers</h2>
        <table>
          <thead>
            <tr>
              <th>Name</th>
              <th>Schedule</th>
              <th>Merchant</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Next Run</th>
            </tr>
          </thead>
          <tbody>
            {triggers.map((t) => (
              <tr key={t.id}>
                <td>{t.name}</td>
                <td>{t.schedule}</td>
                <td>{t.merchant}</td>
                <td>{t.amount}</td>
                <td>{t.status}</td>
                <td>{t.nextRun}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Create Trigger</h2>
        <p>
          New triggers are validated against your buyer policy before activation.
          They require a valid mandate and must not exceed policy limits.
        </p>
        <ul>
          <li>Cron schedule (e.g., monthly on the 1st)</li>
          <li>Fixed interval (e.g., every 7 days)</li>
          <li>Amount template with currency</li>
          <li>Target merchant from allowlist</li>
        </ul>
      </section>

      <section>
        <h2>Execution History</h2>
        <p>
          Each trigger execution generates a full transaction lifecycle:
          proposal, policy check, intent, and receipt.
        </p>
      </section>
    </main>
  );
}
