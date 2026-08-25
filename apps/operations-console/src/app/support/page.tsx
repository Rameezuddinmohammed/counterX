import { createOperatorApiClient } from "../../lib/operator-api-client";

/**
 * Support Sessions page showing active grants with scope, expiry, and purpose.
 */
export default async function SupportSessionsPage() {
  const client = createOperatorApiClient();
  const sessions = await client.getSupportSessions();

  return (
    <main>
      <h1>Support Sessions</h1>
      <p>Active expiring support grants with scope, purpose, and permissions.</p>
      {sessions.length === 0 ? (
        <p>No active support sessions.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Grant ID</th>
              <th>Operator</th>
              <th>Target Scope</th>
              <th>Purpose</th>
              <th>Permissions</th>
              <th>Expires</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.grantId}>
                <td>{session.grantId}</td>
                <td>{session.operatorId}</td>
                <td>{session.targetScope}</td>
                <td>{session.purpose}</td>
                <td>{session.permissions.join(", ")}</td>
                <td>{session.expiresAt}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
