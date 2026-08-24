import { createOperatorApiClient } from "../../lib/operator-api-client";

/**
 * Kill Switches page listing active/inactive switches with toggle controls.
 */
export default async function KillSwitchesPage() {
  const client = createOperatorApiClient();
  const switches = await client.getKillSwitches();

  return (
    <main>
      <h1>Kill Switches</h1>
      <p>Server-side feature flags that disable functionality for specific scopes.</p>
      {switches.length === 0 ? (
        <p>No kill switches configured.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Scope</th>
              <th>Entity</th>
              <th>Status</th>
              <th>Reason</th>
              <th>Activated By</th>
              <th>Expires</th>
            </tr>
          </thead>
          <tbody>
            {switches.map((sw) => (
              <tr key={sw.id}>
                <td>{sw.id}</td>
                <td>{sw.scope}</td>
                <td>{sw.entityId ?? "all"}</td>
                <td>{sw.status}</td>
                <td>{sw.reason}</td>
                <td>{sw.activatedBy}</td>
                <td>{sw.expiresAt ?? "never"}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
