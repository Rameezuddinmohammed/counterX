import { createOperatorApiClient } from "../../lib/operator-api-client.js";

/**
 * Incidents page listing active incidents with severity and scope.
 */
export default async function IncidentsPage() {
  const client = createOperatorApiClient();
  const incidents = await client.getIncidents();

  return (
    <main>
      <h1>Incidents</h1>
      <p>Active incidents with severity and scope.</p>
      {incidents.length === 0 ? (
        <p>No active incidents. All systems nominal.</p>
      ) : (
        <ul>
          {incidents.map((incident) => (
            <li key={incident.id}>
              <strong>[{incident.severity}]</strong> {incident.title} - scope: {incident.scope}
              <br />
              Started: {incident.startedAt}
              {incident.resolvedAt ? ` | Resolved: ${incident.resolvedAt}` : ""}
            </li>
          ))}
        </ul>
      )}
    </main>
  );
}
