import { createOperatorApiClient } from "../../lib/operator-api-client.js";

/**
 * Adapter Release Status page showing connector/payment adapter versions and health.
 */
export default async function AdapterReleasePage() {
  const client = createOperatorApiClient();
  const adapters = await client.getAdapterReleases();

  return (
    <main>
      <h1>Adapter Release Status</h1>
      <p>Connector and payment adapter versions, health, and deployment status.</p>
      {adapters.length === 0 ? (
        <p>No adapter data available. Connect to operator API for live status.</p>
      ) : (
        <table>
          <thead>
            <tr>
              <th>Adapter</th>
              <th>Version</th>
              <th>Status</th>
              <th>Last Deployed</th>
              <th>Transactions</th>
            </tr>
          </thead>
          <tbody>
            {adapters.map((adapter) => (
              <tr key={adapter.adapterId}>
                <td>{adapter.name}</td>
                <td>{adapter.version}</td>
                <td>{adapter.status}</td>
                <td>{adapter.lastDeployed}</td>
                <td>{adapter.transactionCount}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </main>
  );
}
