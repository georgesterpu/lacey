import { test, expect } from "bun:test";
import { smokeFixture } from "../scripts/smoke-fixture";
import {
  readPublicCatalogue,
  publicProductStatement,
  publicFailureStatement,
  canRetainPublished,
} from "../src/public-catalogue";
import {currentDeals} from '../src/catalogue';
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
test('a delayed refresh retains bounded browsing facts without authorizing stale email candidates',async()=>{
 const f=await smokeFixture('');try{
  const source=await f.env.DB.prepare("SELECT last_success FROM sources WHERE id='amphibian'").first<{last_success:string}>();
  expect(await canRetainPublished(f.env,'amphibian')).toBe(true);
  await f.env.DB.prepare("UPDATE sources SET status='error',error='Store returned HTTP 429' WHERE id='amphibian'").run();
  await publicFailureStatement(f.env,'amphibian','Store returned HTTP 429',new Date().toISOString(),true).run();
  expect((await readPublicCatalogue(f.env)).offers).toHaveLength(500);
  expect(await currentDeals(f.env)).toHaveLength(0);
  expect((await f.env.DB.prepare("SELECT last_success FROM sources WHERE id='amphibian'").first<{last_success:string}>())?.last_success).toBe(source?.last_success);
  await f.env.DB.prepare("INSERT INTO app_state(key,value) VALUES('ops:source-pause:amphibian','Access review')").run();
  expect(await canRetainPublished(f.env,'amphibian')).toBe(false);
  const row=await f.env.DB.prepare("SELECT value FROM app_state WHERE key='public:shop:amphibian'").first<{value:string}>();
  const record=JSON.parse(row!.value);for(const groups of Object.values(record.products)as any[][])for(const offer of groups)offer.checked_at=new Date(Date.now()-31*3600000).toISOString();
  await f.env.DB.prepare("UPDATE app_state SET value=? WHERE key='public:shop:amphibian'").bind(JSON.stringify(record)).run();
  expect((await readPublicCatalogue(f.env)).offers).toHaveLength(0);
 }finally{f.close();}
},15000);
