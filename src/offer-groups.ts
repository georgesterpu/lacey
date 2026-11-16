import type { Offer } from "./types";
import { discount } from "./types";
export function groupOffers(offers: Offer[]) {
  const groups = new Map<
    string,
    Offer & {
      sizes: string[];
      discount: number;
      sizeUrls: Record<string, string>;
    }
  >();
  for (const o of offers) {
    const key = [
      o.source_id,
      o.product_id,
      o.price,
      o.reference_price,
      o.colour,
      o.size_system,
    ].join("|");
    const found = groups.get(key);
    if (found) {
      found.sizes.push(o.size);
      if (o.url !== found.url) found.sizeUrls[o.size] = o.url;
    } else
      groups.set(key, {
        ...o,
        sizes: [o.size],
        discount: discount(o),
        sizeUrls: {},
      });
  }
  return [...groups.values()]
    .map((g) => ({
      ...g,
      sizes: [...new Set(g.sizes)].sort((a, b) => Number(a) - Number(b)),
    }))
    .sort((a, b) => b.discount - a.discount || a.price - b.price);
}
