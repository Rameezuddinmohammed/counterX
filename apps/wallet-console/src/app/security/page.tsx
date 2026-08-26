/**
 * Security and recovery page.
 */
export default function SecurityPage() {
  return (
    <main>
      <h1>Security &amp; Recovery</h1>
      <p>
        Manage wallet security settings, recovery options, and view the
        security audit log.
      </p>

      <section>
        <h2>Recovery Lock</h2>
        <p>
          Activate recovery lock to immediately freeze all wallet operations.
          This locks the key store and prevents any signing until re-registration.
        </p>
        <div>
          <span>Current status: </span>
          <span>Unlocked</span>
        </div>
        <p>
          Recovery lock is used when a device is lost or compromised. It
          provides an immediate safety mechanism.
        </p>
      </section>

      <section>
        <h2>Key Management</h2>
        <ul>
          <li>Active signing keys: 2</li>
          <li>Revoked keys: 1</li>
          <li>Key algorithm: Ed25519</li>
          <li>Key store status: Unlocked</li>
        </ul>
        <p>
          Key revocation is irreversible. Revoked keys cannot sign any
          future operations.
        </p>
      </section>

      <section>
        <h2>Device Revocation</h2>
        <p>
          Revoke a paired device to immediately prevent it from performing
          any wallet operations. Device revocation cascades to all mandates
          issued to agents on that device.
        </p>
      </section>

      <section>
        <h2>Re-registration</h2>
        <p>
          After activating recovery lock, use re-registration to create a
          new device binding and key pair. This requires step-up authentication
          (high assurance level).
        </p>
        <ol>
          <li>Activate recovery lock (freezes everything)</li>
          <li>Revoke compromised devices/keys</li>
          <li>Re-authenticate with high assurance</li>
          <li>Generate new key pair</li>
          <li>Create new device pairing</li>
        </ol>
      </section>

      <section>
        <h2>Security Audit Log</h2>
        <p>
          All security-sensitive operations are logged with timestamps and
          principal IDs. The audit trail is retained even after data deletion.
        </p>
      </section>
    </main>
  );
}
