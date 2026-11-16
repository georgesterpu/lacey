import type { DatabaseClient, DatabaseRows } from "./database-client";
import { postgresClient } from "./postgres";
import {
  createClient,
  type InStatement,
  type InValue,
} from "@libsql/client/web";
import type { DB, Statement } from "./types";
export function resultRows<T>(result: DatabaseRows): T[] {
  return result.rows.map(
    (row) =>
      Object.fromEntries(
        result.columns.map((column) => [column, row[column]]),
      ) as T,
  );
}
function argument(value: unknown): InValue {
  if (
    value === null ||
    typeof value === "string" ||
    typeof value === "number" ||
    typeof value === "bigint" ||
    value instanceof Uint8Array
  )
    return value;
  if (typeof value === "boolean") return Number(value);
  throw new Error("Unsupported database parameter");
}
class Query implements Statement {
  constructor(
    readonly client: DatabaseClient,
    readonly sql: string,
    readonly args: unknown[] = [],
  ) {}
  bind(...values: unknown[]) {
    return new Query(this.client, this.sql, values);
  }
  input(): InStatement {
    return { sql: this.sql, args: this.args.map(argument) };
  }
  async all<T>() {
    const start = performance.now(),
      label = this.sql.replace(/\s+/g, " ").slice(0, 75);
    const pending = setTimeout(
      () => console.warn("Database read is slow", { query: label }),
      2000,
    );
    try {
      return {
        results: resultRows<T>(await this.client.execute(this.input())),
      };
    } finally {
      clearTimeout(pending);
      if (performance.now() - start > 2000)
        console.warn("Database read completed", {
          query: label,
          ms: Math.round(performance.now() - start),
        });
    }
  }
  async first<T>() {
    return (await this.all<T>()).results[0] ?? null;
  }
  async run() {
    return this.client.execute(this.input());
  }
}
export function databaseAdapter(client: DatabaseClient): DB {
  return {
    dialect: client.dialect ?? "sqlite",
    prepare: (sql) => new Query(client, sql),
    batch: async (statements) =>
      client.batch(
        statements.map((statement) => {
          if (!(statement instanceof Query) || statement.client !== client)
            throw new Error("Cannot mix database connections in a transaction");
          return statement.input();
        }),
        "write",
      ),
  };
}
export function remoteClient(config: {
  TURSO_DATABASE_URL?: string;
  TURSO_AUTH_TOKEN?: string;
  timeoutMs?: number;
  LACEY_PG_DATABASE_URL?: string;
}): DatabaseClient {
  if (config.LACEY_PG_DATABASE_URL)
    return postgresClient(config.LACEY_PG_DATABASE_URL, {
      timeoutMs: config.timeoutMs,
    });
  if (!config.TURSO_DATABASE_URL || !config.TURSO_AUTH_TOKEN)
    throw new Error("Production database credentials are missing");
  const url = new URL(config.TURSO_DATABASE_URL);
  if (!["libsql:", "https:"].includes(url.protocol))
    throw new Error("Production requires a remote TLS database");
  return createClient({
    url: config.TURSO_DATABASE_URL,
    authToken: config.TURSO_AUTH_TOKEN,
    intMode: "number",
    concurrency: 1,
    fetch: async (input: RequestInfo | URL, init?: RequestInit) => {
      const start = performance.now();
      const response = await fetch(input, {
        ...init,
        signal: init?.signal
          ? AbortSignal.any([
              init.signal,
              AbortSignal.timeout(config.timeoutMs ?? 15000),
            ])
          : AbortSignal.timeout(config.timeoutMs ?? 15000),
      });
      const ms = Math.round(performance.now() - start);
      if (ms > 2000)
        console.warn("Database HTTP headers are slow", {
          ms,
          status: response.status,
        });
      return response;
    },
  });
}
