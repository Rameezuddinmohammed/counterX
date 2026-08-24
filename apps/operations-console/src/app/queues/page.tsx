import { createOperatorApiClient } from "../../lib/operator-api-client.js";

/**
 * Queues page showing job queue depth and dead letters with replay option.
 */
export default async function QueuesPage() {
  const client = createOperatorApiClient();
  const queues = await client.getQueues();
  const deadLetters = await client.getDeadLetters();

  return (
    <main>
      <h1>Queues &amp; Dead Letters</h1>

      <section>
        <h2>Job Queues</h2>
        {queues.length === 0 ? (
          <p>No queue data available.</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>Queue</th>
                <th>Depth</th>
                <th>Oldest Job (s)</th>
                <th>Rate (jobs/s)</th>
              </tr>
            </thead>
            <tbody>
              {queues.map((q) => (
                <tr key={q.name}>
                  <td>{q.name}</td>
                  <td>{q.depth}</td>
                  <td>{q.oldestJobAge}</td>
                  <td>{q.processingRate}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      <section>
        <h2>Dead Letters</h2>
        {deadLetters.length === 0 ? (
          <p>No dead letters. All messages processed successfully.</p>
        ) : (
          <ul>
            {deadLetters.map((dl) => (
              <li key={dl.id}>
                [{dl.queue}] Failed at {dl.failedAt} after {dl.attempts} attempts: {dl.lastError}
              </li>
            ))}
          </ul>
        )}
      </section>
    </main>
  );
}
