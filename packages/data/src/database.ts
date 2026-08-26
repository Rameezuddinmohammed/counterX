import pg from "pg";
import type { PoolConfig, PoolClient, QueryResult, QueryResultRow } from "pg";

const { Pool } = pg;
type Pool = InstanceType<typeof Pool>;

export interface DatabaseSession {
  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>>;
}

export interface TransactionalDatabase extends DatabaseSession {
  transaction<Result>(operation: (session: DatabaseSession) => Promise<Result>): Promise<Result>;
}

export class PostgresDatabase implements TransactionalDatabase {
  readonly #pool: Pool;

  constructor(configuration: PoolConfig | string) {
    this.#pool = new Pool(
      typeof configuration === "string" ? { connectionString: configuration } : configuration,
    );
  }

  query<Row extends QueryResultRow = QueryResultRow>(
    text: string,
    values?: readonly unknown[],
  ): Promise<QueryResult<Row>> {
    return this.#pool.query<Row>(text, values === undefined ? undefined : [...values]);
  }

  async transaction<Result>(
    operation: (session: DatabaseSession) => Promise<Result>,
  ): Promise<Result> {
    const client = await this.#pool.connect();
    try {
      await client.query("BEGIN");
      const result = await operation(asSession(client));
      await client.query("COMMIT");
      return result;
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
  }

  async close(): Promise<void> {
    await this.#pool.end();
  }
}

function asSession(client: PoolClient): DatabaseSession {
  return {
    query<Row extends QueryResultRow = QueryResultRow>(
      text: string,
      values?: readonly unknown[],
    ): Promise<QueryResult<Row>> {
      return client.query<Row>(text, values === undefined ? undefined : [...values]);
    },
  };
}
