/**
 * Devices page - device pairing and agent management.
 */
export default function DevicesPage() {
  const devices = [
    { id: "dev-001", name: "Primary Laptop", status: "active", pairedAt: "2025-01-01" },
    { id: "dev-002", name: "Mobile Agent", status: "active", pairedAt: "2025-01-05" },
  ];

  return (
    <main>
      <h1>Devices &amp; Agents</h1>
      <p>Manage paired devices and registered agents for this wallet.</p>

      <section>
        <h2>Paired Devices</h2>
        <table>
          <thead>
            <tr>
              <th>Device</th>
              <th>Status</th>
              <th>Paired</th>
              <th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {devices.map((device) => (
              <tr key={device.id}>
                <td>{device.name}</td>
                <td>{device.status}</td>
                <td>{device.pairedAt}</td>
                <td>Revoke</td>
              </tr>
            ))}
          </tbody>
        </table>
      </section>

      <section>
        <h2>Pair New Device</h2>
        <p>
          Initiate a new device pairing by generating a challenge. The new
          device must sign the challenge with its Ed25519 key to prove
          possession.
        </p>
        <div>
          <span>Pairing TTL: 5 minutes</span>
        </div>
      </section>

      <section>
        <h2>Agent Registration</h2>
        <p>
          Agents are software processes that act on behalf of the wallet
          within the bounds of their mandate.
        </p>
        <ul>
          <li>Each agent requires a unique key pair</li>
          <li>Agents operate under mandates (not raw key authority)</li>
          <li>Agent revocation cascades to all its mandates</li>
        </ul>
      </section>
    </main>
  );
}
