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
) => `o.available=1 AND o.checked_at>=? AND o.reference_price>o.price
  AND o.price*100<=o.reference_price*80
  AND NOT EXISTS(SELECT 1 FROM product_checks p WHERE p.run_id=${runId}
    AND p.source_id=o.source_id AND p.product_id=o.product_id AND p.checked_at>=o.checked_at
    AND (p.status!='ok' OR NOT EXISTS(SELECT 1 FROM json_each(p.payload) v
      WHERE json_extract(v.value,'$.id')=o.id AND json_extract(v.value,'$.available')=1
      AND json_extract(v.value,'$.price')=o.price
      AND json_extract(v.value,'$.reference_price')=o.reference_price)))`;
export const snapshotDealsSql = `SELECT ${columns},o.run_id FROM offer_snapshots o
  WHERE o.snapshot_id=? AND ${eligible("o.run_id")} ORDER BY checked_at DESC LIMIT ?`;
const legacyDealsSql = `SELECT ${columns},NULL AS run_id FROM offers o
  WHERE o.source_id=? AND ${eligible("NULL")} ORDER BY checked_at DESC LIMIT ?`;
// libSQL's typed row protocol repeats metadata for every field of every size.
// Return one JSON value per shop instead, avoiding thousands of driver row
// wrappers on the function's CPU while preserving every verified size fact.
const packed = (sql: string) =>
  `SELECT json_group_array(json_object(${[...fields.split(","), "run_id"].map((name) => `'${name}',o.${name}`).join(",")})) AS offers FROM (${sql}) o`;
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
  const cutoff = freshCutoff();
  const groups = await Promise.all(
    sources.map((source) =>
      env.DB.prepare(
        packed(source.live_snapshot_id ? snapshotDealsSql : legacyDealsSql),
      )
        .bind(source.live_snapshot_id ?? source.id, cutoff, limit)
        .first<{ offers: string }>()
        .then((row) => JSON.parse(row?.offers ?? "[]") as Offer[]),
    ),
  );
  const rows = groups
    .flat()
    .sort((a, b) => b.checked_at.localeCompare(a.checked_at));
  return limit < 0 ? rows : rows.slice(0, limit);
}
