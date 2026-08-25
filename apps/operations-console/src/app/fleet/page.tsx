import { createOperatorApiClient } from "../../lib/operator-api-client";

/**
 * Fleet Health page showing dependency health status grid.
 */
export default async function FleetHealthPage() {
  const client = createOperatorApiClient();
  const dependencies = await client.getFleetHealth();

  return (
    <main>
      <h1>Fleet Health</h1>
      <p>Dependency health status grid.</p>
      {dependencies.length === 0 ? (
        <p>No health check data available. Connect to operator API for live status.</p>
      ) : (
        <ul>
          {dependencies.map((dep) => (
            <li key={dep.name}>
              <strong>{dep.name}</strong>: {dep.status}
              {dep.message ? ` - ${dep.message}` : ""}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
