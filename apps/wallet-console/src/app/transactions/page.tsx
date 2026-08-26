/**
 * Transaction history page with claims, findings, and receipts.
 */
export default function TransactionsPage() {
  const transactions = [
    {
      id: "tx-001",
      merchant: "BookStore India",
      amount: "8,500 INR",
      status: "completed",
      date: "2025-01-15",
      receipt: true,
    },
    {
      id: "tx-002",
      merchant: "CloudHost Pro",
      amount: "12,000 INR",
      status: "completed",
      date: "2025-01-14",
      receipt: true,
    },
    {
      id: "tx-003",
      merchant: "OfficeSupply Co",
      amount: "3,200 INR",
      status: "pending_fulfillment",
      date: "2025-01-14",
      receipt: false,
    },
  ];

  return (
    <main>
      <h1>Transactions</h1>
      <p>View transaction history with associated claims, findings, and receipts.</p>

      <section>
        <h2>Transaction History</h2>
        <table>
          <thead>
            <tr>
              <th>Merchant</th>
              <th>Amount</th>
              <th>Status</th>
              <th>Date</th>
              <th>Receipt</th>
            </tr>
          </thead>
          <tbody>
            {transactions.map((tx) => (
              <tr key={tx.id}>
                <td>{tx.merchant}</td>
                <td>{tx.amount}</td>
                <td>{tx.status}</td>
                <td>{tx.date}</td>
                <td>{tx.receipt ? "Available" : "Pending"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Claims &amp; Findings</h2>
        <p>
          Claims record observations about transactions. Findings represent
          identified issues or deviations that may require attention.
        </p>
        <ul>
          <li>Claims are recorded by agents based on transaction observations</li>
          <li>Findings flag potential issues (late delivery, price mismatch)</li>
          <li>Receipts provide cryptographic proof of transaction state</li>
        </ul>
      </section>

      <section>
        <h2>Receipt Verification</h2>
        <p>
          Each receipt is a CTP-signed envelope that can be independently
          verified. Receipts are audience-scoped (merchant view vs wallet view).
        </p>
      </section>
    </main>
  );
}
