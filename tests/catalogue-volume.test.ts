import { test, expect } from "bun:test";
import { smokeFixture } from "../scripts/smoke-fixture";
import { currentDeals, snapshotDealsSql } from "../src/catalogue";
import { offerStatements } from "../src/snapshots";

test("a large unpublished catalogue cannot enter or turn the public read into a full-table scan", async () => {
  const fixture = await smokeFixture("");
  try {
    let pages = 0;
    const prepare = fixture.env.DB.prepare;
    fixture.env.DB.prepare = (sql) => {
      const statement = prepare(sql);
      if (!sql.startsWith("SELECT json_group_array")) return statement;
      return new Proxy(statement, {
        get(target, key) {
          if (key === "bind")
            return (...args: unknown[]) => {
              pages++;
              expect(args.at(-1)).toBe(250);
              return target.bind(...args);
            };
          const value = Reflect.get(target, key);
          return typeof value === "function" ? value.bind(target) : value;
        },
      });
    };
    const rows = await currentDeals(fixture.env);
    expect(pages).toBe(9);
    expect(new Set(rows.map((row) => row.id)).size).toBe(2000);
    expect(rows).toHaveLength(2000);
    expect(rows.every((row) => !row.title.includes("UNPUBLISHED"))).toBe(true);
    const snapshot = await fixture.env.DB.prepare(
      "SELECT live_snapshot_id FROM sources WHERE id='amphibian'",
    ).first<{ live_snapshot_id: string }>();
    const plan = await fixture.client.execute({
      sql: "EXPLAIN QUERY PLAN " + snapshotDealsSql,
      args: [snapshot!.live_snapshot_id, "", new Date().toISOString(), 250],
    });
    expect(
      plan.rows.some((row) => String(row.detail).includes("snapshot_id=?")),
    ).toBe(true);
    expect(plan.rows.some((row) => String(row.detail) === "SCAN o")).toBe(
      false,
    );
    // 2,000 size rows require four SQL operations, not 2,000 remote statements.
    expect(offerStatements(fixture.env, "run", rows)).toHaveLength(4);
    const one = rows[0];
    expect(
      offerStatements(fixture.env, "run", [
        one,
        { ...one, source_id: "elverys" },
      ]),
    ).toHaveLength(2);
  } finally {
    fixture.close();
  }
}, 15000);
