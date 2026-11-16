import type { Env, Offer } from "./types";
export interface CatalogueSource {
  id: string;
  live_snapshot_id: string | null;
  status: string;
}
import { freshCutoff } from "./types";
const fields =
  "id,source_id,product_id,title,brand,category,fit,size_system,size,colour,price,reference_price,currency,image,url,available,checked_at";
const columns = fields
  .split(",")
  .map((name) => `o.${name}`)
  .join(",");
const eligible = (
  runId: string,
  pg = false,
) => `o.available=1 AND o.checked_at>=? AND o.reference_price>o.price
  AND o.price*100<=o.reference_price*80
  AND NOT EXISTS(SELECT 1 FROM product_checks p WHERE p.run_id=${runId}
    AND p.source_id=o.source_id AND p.product_id=o.product_id AND p.checked_at>=o.checked_at
    AND (p.status!='ok' OR NOT EXISTS(SELECT 1 FROM ${pg ? "jsonb_array_elements(p.payload::jsonb)" : "json_each(p.payload)"} v
      WHERE ${pg ? "v.value->>'id'" : "json_extract(v.value,'$.id')"}=o.id AND ${pg ? "(v.value->>'available')::integer" : "json_extract(v.value,'$.available')"}=1
      AND ${pg ? "(v.value->>'price')::integer" : "json_extract(v.value,'$.price')"}=o.price
      AND ${pg ? "(v.value->>'reference_price')::integer" : "json_extract(v.value,'$.reference_price')"}=o.reference_price)))`;
const snapshotSql = (
  pg = false,
) => `SELECT ${columns},o.run_id FROM offer_snapshots o
  WHERE o.snapshot_id=? AND o.id>? AND ${eligible("o.run_id", pg)} ORDER BY o.id LIMIT ?`;
const legacySql = (
  pg = false,
) => `SELECT ${columns},NULL AS run_id FROM offers o
  WHERE o.source_id=? AND o.id>? AND ${eligible("NULL", pg)} ORDER BY o.id LIMIT ?`;
export const snapshotDealsSql = snapshotSql();
// libSQL's typed row protocol repeats metadata for every field of every size.
// Return one JSON value per shop instead, avoiding thousands of driver row
// wrappers on the function's CPU while preserving every verified size fact.
const packed = (sql: string, pg: boolean) => {
  const pairs = [...fields.split(","), "run_id"]
    .map((name) => `'${name}',o.${name}`)
    .join(",");
  const aggregate = pg
    ? `COALESCE(jsonb_agg(jsonb_build_object(${pairs})),'[]'::jsonb)::text`
    : `json_group_array(json_object(${pairs}))`;
  return `SELECT ${aggregate} AS offers FROM (${sql}) o`;
};
// Seek only each shop's published snapshot by its primary key. The old UNION
// view scanned staged/historical variants too and stalled the entire dashboard.
export async function currentDeals(
  env: Env,
  limit = -1,
  knownSources?: CatalogueSource[],
) {
  const sources = (
    knownSources ??
    (
      await env.DB.prepare(
        "SELECT id,live_snapshot_id,status FROM sources WHERE status IN('live','partial')",
      ).all<CatalogueSource>()
    ).results
  ).filter((source) => ["live", "partial"].includes(source.status));
  if (!sources.length) return [];
  const cutoff = freshCutoff();
  // Bound each HTTP result, rather than building a single multi-megabyte
  // libSQL response. Keyset pagination preserves all variants without OFFSET
  // scans as a shop grows. Shop reads can proceed independently.
  const groups = await Promise.all(
    sources.map(async (source) => {
      const sql = packed(
        source.live_snapshot_id
          ? snapshotSql(env.DB.dialect === "postgres")
          : legacySql(env.DB.dialect === "postgres"),
        env.DB.dialect === "postgres",
      );
      const offers: Offer[] = [];
      let cursor = "";
      while (true) {
        const result = await env.DB.prepare(sql)
          .bind(source.live_snapshot_id ?? source.id, cursor, cutoff, 250)
          .first<{ offers: string }>();
        if (!result) throw new Error("Catalogue page unavailable");
        const page = JSON.parse(result.offers) as Offer[];
        offers.push(...page);
        if (page.length < 250) return offers;
        cursor = page[page.length - 1].id;
      }
    }),
  );
  const rows = groups
    .flat()
    .sort((a, b) => b.checked_at.localeCompare(a.checked_at));
  return limit < 0 ? rows : rows.slice(0, limit);
}
