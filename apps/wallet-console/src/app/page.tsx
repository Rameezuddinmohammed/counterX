/**
 * Dashboard page - wallet status overview.
 */
export default function DashboardPage() {
  const overview = {
    walletId: "wlt-pilot-001",
    status: "active" as const,
    createdAt: "2025-01-01",
    deviceCount: 2,
    activeMandates: 3,
    pendingApprovals: 1,
    recentTransactions: 12,
    triggerCount: 2,
    policyVersion: "v3",
  };

  return (
    <main>
      <h1>Counter Wallet Console</h1>
      <p>Wallet status overview for pilot operations.</p>

      <section>
        <h2>Wallet Status</h2>
        <dl>
          <dt>Wallet ID</dt>
          <dd>{overview.walletId}</dd>
          <dt>Status</dt>
          <dd>{overview.status}</dd>
          <dt>Created</dt>
          <dd>{overview.createdAt}</dd>
          <dt>Policy Version</dt>
          <dd>{overview.policyVersion}</dd>
        </dl>
      </section>

      <section>
        <h2>Summary</h2>
        <ul>
          <li>Paired Devices: {overview.deviceCount}</li>
          <li>Active Mandates: {overview.activeMandates}</li>
          <li>Pending Approvals: {overview.pendingApprovals}</li>
          <li>Recent Transactions: {overview.recentTransactions}</li>
          <li>Active Triggers: {overview.triggerCount}</li>
        </ul>
      </section>

      <section>
        <h2>Quick Actions</h2>
        <ul>
          <li>
            <a href="/approvals">Review pending approvals</a>
          </li>
          <li>
            <a href="/transactions">View transaction history</a>
          </li>
          <li>
            <a href="/policy">Edit buyer policy</a>
          </li>
          <li>
            <a href="/security">Security settings</a>
          </li>
        </ul>
      </section>
    </main>
  );
}
