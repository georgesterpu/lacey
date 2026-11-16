import type { InStatement } from "@libsql/client/web";
import type { DatabaseClient } from "./database-client";
export interface Migration {
  tag: string;
  sql: string;
}
export async function checksum(sql: string) {
  return Array.from(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(sql)),
    ),
  )
    .map((v) => v.toString(16).padStart(2, "0"))
    .join("");
}
export async function migrate(client: DatabaseClient, migrations: Migration[]) {
  if (client.dialect !== "postgres") {
    const foreignKeys = await client.execute("PRAGMA foreign_keys");
    if (Number(foreignKeys.rows[0]?.foreign_keys) !== 1)
      throw new Error("Foreign key enforcement is required");
  }
  const table = await client.execute(
    client.dialect === "postgres"
      ? "SELECT table_name AS name FROM information_schema.tables WHERE table_schema=current_schema() AND table_name='schema_migrations'"
      : "SELECT name FROM sqlite_schema WHERE type='table' AND name='schema_migrations'",
  );
  const existing = table.rows.length
    ? await client.execute(
        "SELECT tag,checksum FROM schema_migrations ORDER BY applied_at,tag",
      )
    : null;
  const known = new Map(
    existing?.rows.map((row) => [String(row.tag), String(row.checksum)]) ?? [],
  );
  for (const tag of known.keys())
    if (!migrations.some((m) => m.tag === tag))
      throw new Error(`Database has an unknown migration: ${tag}`);
  const statements: (string | InStatement)[] = [
    "CREATE TABLE IF NOT EXISTS schema_migrations(tag TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TEXT NOT NULL)",
  ];
  let gap = false,
    applied = 0;
  for (const m of migrations) {
    const hash = await checksum(m.sql);
    if (known.has(m.tag)) {
      if (gap || known.get(m.tag) !== hash)
        throw new Error(`Applied migration changed or reordered: ${m.tag}`);
      continue;
    }
    gap = true;
    statements.push(
      ...m.sql
        .split("--> statement-breakpoint")
        .map((s) => s.trim())
        .filter(Boolean),
    );
    statements.push({
      sql: "INSERT INTO schema_migrations VALUES(?,?,?)",
      args: [m.tag, hash, new Date().toISOString()],
    });
    applied++;
  }
  // A single server-side transaction avoids holding an interactive transaction
  // open across slow HTTP round trips. DDL and its checksum commit together.
  await client.batch(statements, "write");
  return { applied, total: migrations.length };
}
