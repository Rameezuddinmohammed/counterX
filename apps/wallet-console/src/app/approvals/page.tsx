/**
 * Approval inbox page.
 */
export default function ApprovalsPage() {
  const pendingApprovals = [
    {
      id: "task-001",
      merchant: "BookStore India",
      amount: "35,000 INR",
      reason: "Exceeds approval threshold (25,000 INR)",
      requestedAt: "2025-01-15 10:30",
    },
  ];

  const recentDecisions = [
    {
      id: "task-002",
      merchant: "CloudHost Pro",
      amount: "12,000 INR",
      decision: "approved",
      decidedAt: "2025-01-14 16:00",
    },
    {
      id: "task-003",
      merchant: "Unknown Vendor",
      amount: "99,000 INR",
      decision: "rejected",
      decidedAt: "2025-01-14 09:15",
    },
  ];

  return (
    <main>
      <h1>Approval Inbox</h1>
      <p>
        Review and decide on transactions that exceed your buyer policy
        thresholds and require explicit principal approval.
      </p>

      <section>
        <h2>Pending Approvals</h2>
        {pendingApprovals.length === 0 ? (
          <p>No pending approvals.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Merchant</th>
                <th>Amount</th>
                <th>Reason</th>
                <th>Requested</th>
                <th>Actions</th>
              </tr>
            </thead>
            <tbody>
              {pendingApprovals.map((item) => (
                <tr key={item.id}>
                  <td>{item.merchant}</td>
                  <td>{item.amount}</td>
                  <td>{item.reason}</td>
                  <td>{item.requestedAt}</td>
                  <td>Approve | Reject</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Recent Decisions</h2>
        <table>
          <thead>
            <tr>
              <th>Merchant</th>
              <th>Amount</th>
              <th>Decision</th>
              <th>Decided</th>
            </tr>
          </thead>
          <tbody>
            {recentDecisions.map((item) => (
              <tr key={item.id}>
                <td>{item.merchant}</td>
                <td>{item.amount}</td>
                <td>{item.decision}</td>
                <td>{item.decidedAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Approval Requirements</h2>
        <ul>
          <li>Step-up authentication required for approval decisions</li>
          <li>Approval tasks expire if not acted upon</li>
          <li>Each approval generates a signed CTP evidence envelope</li>
          <li>Decisions are irrevocable once submitted</li>
        </ul>
      </section>
    </main>
  );
}
