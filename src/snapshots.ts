import type { Env, Offer, Statement } from "./types";
const fields =
  "id,source_id,product_id,title,brand,category,fit,size_system,size,colour,price,reference_price,currency,image,url,available,checked_at";
const names = fields.split(",") as (keyof Offer)[];
// Multi-row VALUES keeps each statement below SQLite's portable 999-parameter
// ceiling and avoids repeatedly decoding large JSON objects on the remote DB.
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
    for (let start = 0; start < offers.length; start += 50) {
      const rows = offers.slice(start, start + 50);
      statements.push(
        env.DB.prepare(
          `INSERT OR REPLACE INTO offer_snapshots
      (snapshot_id,run_id,${fields}) VALUES ${rows
        .map(
          () =>
            `(${Array(names.length + 2)
              .fill("?")
              .join(",")})`,
        )
        .join(",")}`,
        ).bind(
          ...rows.flatMap((row) => [
            key,
            runId,
            ...names.map((name) => row[name]),
          ]),
        ),
      );
    }
  return statements;
}

export function inventorySummary(offers: Offer[]) {
  const products = new Set(offers.map((o) => o.product_id));
  const available = new Set(
    offers.filter((o) => o.available === 1).map((o) => o.product_id),
  );
  return {
    products: products.size,
    variants: offers.length,
    availableProducts: available.size,
    soldOutProducts: products.size - available.size,
  };
}
