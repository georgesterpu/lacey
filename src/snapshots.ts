import type { Env, Offer } from './types';
// One representation for every retailer; source-specific code only produces facts.
export function offerStatements(
  env: Env,
  runId: string,
  offers: Offer[],
  snapshot?: string,
) {
  return offers.map((o) =>
    env.DB.prepare(
      `INSERT OR REPLACE INTO offer_snapshots
  (snapshot_id,run_id,id,source_id,product_id,title,brand,category,fit,size_system,size,colour,price,reference_price,currency,image,url,available,checked_at)
  VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)`,
    ).bind(
      snapshot ?? `${runId}:${o.source_id}`,
      runId,
      o.id,
      o.source_id,
      o.product_id,
      o.title,
      o.brand,
      o.category,
      o.fit,
      o.size_system,
      o.size,
      o.colour,
      o.price,
      o.reference_price,
      o.currency,
      o.image,
      o.url,
      o.available,
      o.checked_at,
    ),
  );
}
