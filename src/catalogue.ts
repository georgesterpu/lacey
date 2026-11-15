import type { Env, Offer } from './types';
import { freshCutoff } from './types';
// Retain catalogue/price data separately from the public deals. An ended sale,
// unavailable variant, stale observation, failed source, or known dead link is
// never a public offer just because its row still exists in retained history.
export async function currentDeals(env:Env,limit=-1) {
 return (await env.DB.prepare(`SELECT o.* FROM current_offers o JOIN sources s ON s.id=o.source_id
  WHERE o.available=1 AND o.checked_at>=? AND o.reference_price>o.price
  AND o.price*100<=o.reference_price*80 AND s.status IN('live','partial')
  AND NOT EXISTS(SELECT 1 FROM product_checks p WHERE p.run_id=o.run_id
    AND p.source_id=o.source_id AND p.product_id=o.product_id AND p.checked_at>=o.checked_at
    AND (p.status!='ok' OR NOT EXISTS(SELECT 1 FROM json_each(p.payload) v
      WHERE json_extract(v.value,'$.id')=o.id AND json_extract(v.value,'$.available')=1
      AND json_extract(v.value,'$.price')=o.price
      AND json_extract(v.value,'$.reference_price')=o.reference_price)))
  ORDER BY o.checked_at DESC LIMIT ?`).bind(freshCutoff(),limit).all<Offer>()).results;
}
