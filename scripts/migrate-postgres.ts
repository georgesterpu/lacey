import { strict as assert } from "node:assert";
import { mkdir, writeFile, chmod } from "node:fs/promises";
import { remoteClient } from "../src/database";
import { postgresClient } from "../src/postgres";
import { encryptBackup, decryptBackup, type Backup } from "../src/backup";
const tables = [
  "sources",
  "scan_runs",
  "source_runs",
  "offers",
  "offer_snapshots",
  "price_history",
  "watches",
  "subscribers",
  "feedback",
  "digest_jobs",
  "recommendation_receipts",
  "notifications",
  "email_identities",
  "email_confirmations",
  "delivery_budget",
  "product_checks",
  "app_state",
] as const;
const members = [
  "watches",
  "subscribers",
  "feedback",
  "digest_jobs",
  "recommendation_receipts",
  "notifications",
  "email_identities",
  "email_confirmations",
  "delivery_budget",
] as const;
const action = process.argv[2],
  file = process.argv[3];
const source = remoteClient({
  TURSO_DATABASE_URL: process.env.TURSO_DATABASE_URL,
  TURSO_AUTH_TOKEN: process.env.TURSO_AUTH_TOKEN,
  timeoutMs: 30000,
});
const target = process.env.LACEY_PG_DATABASE_URL
  ? postgresClient(process.env.LACEY_PG_DATABASE_URL)
  : undefined;
const signature = (rows: Record<string, unknown>[]) =>
  new Bun.CryptoHasher("sha256")
    .update(
      rows
        .map((row) =>
          JSON.stringify(
            Object.fromEntries(
              Object.entries(row).sort(([a], [b]) => a.localeCompare(b)),
            ),
          ),
        )
        .sort()
        .join("\n"),
    )
    .digest("hex");
try {
  if (action === "prepare-freeze") {
    // Inactive until one atomic operational-key write activates every trigger.
    // SQLite serializes that write after any in-flight customer transaction.
    for (const table of members)
      for (const event of ["INSERT", "UPDATE", "DELETE"]) {
        const start = performance.now();
        await source.execute(`CREATE TRIGGER IF NOT EXISTS cutover_${table}_${event.toLowerCase()} BEFORE ${event} ON ${table}
        WHEN (SELECT value FROM app_state WHERE key='ops:cutover')='frozen'
        BEGIN SELECT RAISE(ABORT,'Database migration in progress; please retry shortly'); END`);
        console.log({
          prepared: table,
          event,
          ms: Math.round(performance.now() - start),
        });
      }
  } else if (action === "freeze-source" || action === "unfreeze-source") {
    if (action === "freeze-source") {
      const count = await source.execute(
        "SELECT count(*) n FROM sqlite_schema WHERE type='trigger' AND name LIKE 'cutover_%'",
      );
      assert.equal(
        Number(count.rows[0].n),
        members.length * 3,
        "Every customer-write trigger must exist",
      );
    }
    await source.execute({
      sql: "INSERT INTO app_state(key,value) VALUES('ops:cutover',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      args: [action === "freeze-source" ? "frozen" : "open"],
    });
    console.log({
      sourceWrites: action === "freeze-source" ? "frozen" : "open",
    });
  } else if (action === "export-source") {
    assert.ok(file?.startsWith(".data/"), "Use a private .data/ export path");
    const data: Backup = {
      format: 1,
      createdAt: new Date().toISOString(),
      tables: {},
    };
    for (const table of [...tables, "schema_migrations"]) {
      const rows: Record<string, unknown>[] = [];
      let cursor = 0;
      while (true) {
        const page = await source.execute({
          sql: `SELECT rowid AS __migration_rowid,* FROM ${table} WHERE rowid>? ORDER BY rowid LIMIT 500`,
          args: [cursor],
        });
        for (const original of page.rows) {
          const row = { ...original };
          cursor = Number(row.__migration_rowid);
          delete row.__migration_rowid;
          rows.push(row);
        }
        if (page.rows.length < 500) break;
      }
      data.tables[table] = rows;
      console.log({ exported: table, rows: rows.length });
    }
    await mkdir(".data/migration", { recursive: true, mode: 0o700 });
    await writeFile(
      file,
      await encryptBackup(data, process.env.BACKUP_ENCRYPTION_KEY ?? ""),
      { mode: 0o600 },
    );
    await chmod(file, 0o600);
    console.log({ encryptedExport: file });
  } else if (action === "import-target" || action === "verify-target") {
    assert.ok(
      target && file,
      "Provide an encrypted export and an isolated Postgres destination",
    );
    const data = await decryptBackup(
      new Uint8Array(await Bun.file(file).arrayBuffer()),
      process.env.BACKUP_ENCRYPTION_KEY ?? "",
    );
    const schema = (
      await target.execute("SELECT tag,checksum FROM schema_migrations")
    ).rows;
    for (const migration of data.tables.schema_migrations)
      assert.ok(
        schema.some(
          (m) => m.tag === migration.tag && m.checksum === migration.checksum,
        ),
        "Schema migration checksum mismatch",
      );
    assert.ok(
      tables.every((t) => Array.isArray(data.tables[t])),
      "Incomplete migration export",
    );
    if (action === "import-target") {
      const tx = await target.transaction("write");
      try {
        for (const table of tables)
          assert.equal(
            Number(
              (await tx.execute(`SELECT count(*) n FROM ${table}`)).rows[0].n,
            ),
            0,
            `Destination must be empty: ${table}`,
          );
        for (const table of tables) {
          const rows = data.tables[table];
          for (let i = 0; i < rows.length; i += 200) {
            const page = rows.slice(i, i + 200),
              keys = Object.keys(page[0]);
            assert.ok(keys.every((k) => /^[a-z_]+$/.test(k)));
            assert.ok(
              page.every(
                (row) =>
                  JSON.stringify(Object.keys(row)) === JSON.stringify(keys),
              ),
              "Inconsistent export columns",
            );
            await tx.execute({
              sql: `INSERT INTO ${table}(${keys.map((k) => `"${k}"`).join(",")}) VALUES${page.map(() => `(${keys.map(() => "?").join(",")})`).join(",")}`,
              args: page.flatMap((row) =>
                keys.map((k) => row[k] as string | number | null),
              ),
            });
          }
          console.log({ copied: table, rows: rows.length });
        }
        await tx.commit();
      } finally {
        tx.close();
      }
    }
    for (const table of tables) {
      const actual: Record<string, unknown>[] = (
        await target.execute(`SELECT * FROM ${table}`)
      ).rows;
      const expected = data.tables[table];
      assert.equal(actual.length, expected.length, `${table}: count mismatch`);
      assert.equal(
        signature(actual),
        signature(expected),
        `${table}: content mismatch`,
      );
      console.log({
        verified: table,
        rows: actual.length,
        allFieldsMatch: true,
      });
    }
  } else
    throw new Error(
      "Choose prepare-freeze, freeze-source, unfreeze-source, export-source, import-target or verify-target",
    );
} finally {
  await source.close();
  await target?.close();
}
