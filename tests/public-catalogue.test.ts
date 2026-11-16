import { test, expect } from "bun:test";
import { smokeFixture } from "../scripts/smoke-fixture";
import {
  readPublicCatalogue,
  publicProductStatement,
  publicFailureStatement,
} from "../src/public-catalogue";
import type { Offer } from "../src/types";
test("public reads only its projection; concurrent stock updates and source failures cannot leave known bad offers", async () => {
  const f = await smokeFixture("");
  try {
    const prepare = f.env.DB.prepare,
      queries: string[] = [];
    f.env.DB.prepare = (sql) => {
      queries.push(sql);
      return prepare(sql);
    };
    const initial = await readPublicCatalogue(f.env);
    expect(initial.offers).toHaveLength(500);
    expect(initial.sources).toHaveLength(8);
    expect(queries).toHaveLength(1);
    expect(queries[0]).toContain("key>='public:'");
    expect(queries[0]).not.toMatch(/watches|subscribers|offer_snapshots/);
    const o = await prepare(
      "SELECT * FROM offer_snapshots WHERE product_id='0' LIMIT 1",
    ).first<Offer>();
    await Promise.all(
      ["0", "1"].map((id) =>
        f.env.DB.batch([
          publicProductStatement(f.env, "amphibian", id, [
            { ...o!, product_id: id, available: 0 },
          ]),
        ]),
      ),
    );
    let current = await readPublicCatalogue(f.env);
    expect(current.offers).toHaveLength(498);
    expect(
      current.sources.find((s) => s.id === "amphibian")!.current_deals,
    ).toBe(498);
    await publicProductStatement(f.env, "amphibian", "2", [
      { ...o!, product_id: "2", price: 10000, reference_price: 10000 },
    ]).run();
    current = await readPublicCatalogue(f.env);
    expect(current.offers).toHaveLength(497);
    await publicFailureStatement(
      f.env,
      "amphibian",
      "Contract changed",
      new Date().toISOString(),
    ).run();
    current = await readPublicCatalogue(f.env);
    expect(current.offers).toHaveLength(0);
    expect(current.sources.find((s) => s.id === "amphibian")!.status).toBe(
      "error",
    );
  } finally {
    f.close();
  }
}, 15000);
