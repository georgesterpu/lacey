import type { Env, Offer, Statement } from "./types";
const fields =
  "id,source_id,product_id,title,brand,category,fit,size_system,size,colour,price,reference_price,currency,image,url,available,checked_at";
const values = fields
  .split(",")
  .map((name) => `json_extract(value,'$.${name}')`)
  .join(",");
// One SQL statement per chunk, not one remote statement per size. Both libSQL
// and local SQLite decode the same facts; the caller's batch remains atomic.
export function offerStatements(
  env: Env,
  runId: string,
  offers: Offer[],
  snapshot?: string,
) {
  const statements: Statement[] = [];
  const groups = new Map<string, Offer[]>();
  for (const offer of offers) {
    const key = snapshot ?? `${runId}:${offer.source_id}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(offer);
  }
  for (const [key, offers] of groups)
    for (let start = 0; start < offers.length; start += 500) {
      const rows = offers.slice(start, start + 500);
      statements.push(
        env.DB.prepare(
          `INSERT OR REPLACE INTO offer_snapshots
      (snapshot_id,run_id,${fields}) SELECT ?,?,${values} FROM json_each(?)`,
        ).bind(key, runId, JSON.stringify(rows)),
      );
    }
  return statements;
}
