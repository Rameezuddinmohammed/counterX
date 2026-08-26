/**
 * Export and closure page.
 */
export default function ExportPage() {
  return (
    <main>
      <h1>Export &amp; Closure</h1>
      <p>
        Export your wallet data, manage retention holds, or close your wallet
        permanently.
      </p>

      <section>
        <h2>Data Export</h2>
        <p>
          Export a complete JSON dump of all your wallet data including
          transactions, mandates, devices, policies, and audit trail.
        </p>
        <ul>
          <li>Export format: JSON</li>
          <li>Includes all transaction history</li>
          <li>Includes mandate and policy records</li>
          <li>Includes device pairing history</li>
          <li>Includes full audit trail</li>
        </ul>
        <div>
          <span>Last export: Never</span>
        </div>
      </section>

      <section>
        <h2>Retention Hold</h2>
        <p>
          A retention hold prevents data deletion while active. This is used
          for legal holds or compliance requirements.
        </p>
        <div>
          <span>Active holds: 0</span>
        </div>
      </section>

      <section>
        <h2>Data Deletion</h2>
        <p>
          Request deletion/anonymization of personal data. This scrubs PII
          from all records but retains the audit trail for compliance.
        </p>
        <ul>
          <li>Transaction details are anonymized</li>
          <li>Device information is removed</li>
          <li>Mandate records are scrubbed</li>
          <li>Audit trail is preserved (with anonymized principal)</li>
        </ul>
        <p>
          Data deletion is blocked while a retention hold is active.
        </p>
      </section>

      <section>
        <h2>Wallet Closure</h2>
        <p>
          Permanently close this wallet. This generates a CTP-signed closure
          receipt as evidence. Closure is irreversible.
        </p>
        <ol>
          <li>Export your data (recommended)</li>
          <li>Remove retention holds</li>
          <li>Request closure (step-up authentication required)</li>
          <li>Receive signed closure receipt</li>
          <li>Data is anonymized per retention policy</li>
        </ol>
      </section>
    </main>
  );
}
