import { SQL } from "bun";
import type {
  DatabaseClient,
  DatabaseInput,
  DatabaseRows,
  DatabaseTransaction,
} from "./database-client";
// Keep the small repository query interface. Only placeholders are converted;
// quoted SQL text and comments are preserved, and values remain bound values.
export function postgresParameters(sql: string) {
  let n = 0;
  return sql.replace(
    /'(?:''|[^'])*'|"(?:""|[^"])*"|--[^\n]*|\/\*[\s\S]*?\*\/|\?/g,
    (t) => (t === "?" ? `$${++n}` : t),
  );
}
function input(value: DatabaseInput) {
  if (typeof value === "string")
    return { sql: postgresParameters(value), args: [] };
  if (value.args && !Array.isArray(value.args))
    throw new Error("Use positional database parameters");
  return {
    sql: postgresParameters(value.sql),
    args: (value.args ?? ([] as unknown[])) as unknown[],
  };
}
function rows(
  result: Record<string, unknown>[] & { count?: number },
): DatabaseRows {
  const converted = result.map((row) =>
    Object.fromEntries(
      Object.entries(row).map(([k, v]) => {
        if (typeof v === "bigint") {
          if (
            v > BigInt(Number.MAX_SAFE_INTEGER) ||
            v < BigInt(Number.MIN_SAFE_INTEGER)
          )
            throw new Error("Database integer exceeds safe range");
          return [k, Number(v)];
        }
        return [k, v];
      }),
    ),
  );
  return {
    columns: Object.keys(converted[0] ?? {}),
    rows: converted,
    rowsAffected: result.count ?? 0,
  };
}
export function postgresClient(
  url: string,
  {
    max = 4,
    schema,
    timeoutMs = 15000,
  }: { max?: number; schema?: string; timeoutMs?: number } = {},
): DatabaseClient {
  if (!/^postgres(?:ql)?:\/\//.test(url))
    throw new Error("Expected a PostgreSQL connection URL");
  if (schema) {
    if (!/^[a-z_][a-z0-9_]*$/.test(schema))
      throw new Error("Invalid database schema");
    const scoped = new URL(url);
    scoped.searchParams.set("options", `-c search_path=${schema}`);
    url = scoped.toString();
  }
  const pool = new SQL(url, {
    max,
    idleTimeout: 20,
    connectionTimeout: 10,
    maxLifetime: 300,
    bigint: true,
    prepare: false,
    connection: {
      application_name: "Lacey",
      ...(schema ? { search_path: schema } : {}),
    },
  });
  const execute = async (db: SQL, value: DatabaseInput) => {
    const q = input(value);
    const pending = db.unsafe(q.sql, q.args);
    const timer = setTimeout(() => pending.cancel(), timeoutMs);
    try {
      return rows(await pending);
    } finally {
      clearTimeout(timer);
    }
  };
  async function batch(db: SQL, values: DatabaseInput[]) {
    const results: DatabaseRows[] = [];
    // Bound the protocol pipeline as well as the transaction. Thousands of
    // simultaneous native queries can exhaust socket buffers before draining.
    for (let i = 0; i < values.length; i += 25)
      results.push(
        ...(await Promise.all(
          values.slice(i, i + 25).map((value) => execute(db, value)),
        )),
      );
    return results;
  }
  return {
    dialect: "postgres",
    execute: (value) => execute(pool, value),
    batch: (values, mode) =>
      pool.begin(
        mode === "read"
          ? "isolation level repeatable read read only"
          : "read write",
        (tx) => batch(tx, values),
      ),
    async transaction() {
      const connection = await pool.reserve();
      try {
        await connection.unsafe("BEGIN");
      } catch (error) {
        connection.release();
        throw error;
      }
      let finished = false;
      const tx: DatabaseTransaction = {
        execute: (value) => execute(connection, value),
        async batch(values) {
          return batch(connection, values);
        },
        async commit() {
          try {
            await connection.unsafe("COMMIT");
          } finally {
            finished = true;
            connection.release();
          }
        },
        async rollback() {
          try {
            await connection.unsafe("ROLLBACK");
          } finally {
            finished = true;
            connection.release();
          }
        },
        close() {
          if (!finished) {
            finished = true;
            void connection
              .unsafe("ROLLBACK")
              .catch(() => {})
              .finally(() => connection.release());
          }
        },
      };
      return tx;
    },
    close: () => pool.close(),
  };
}
