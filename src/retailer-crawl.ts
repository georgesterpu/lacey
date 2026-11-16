import type { Offer } from "./types";
import { ProductValidationError, type CrawlCursor } from "./twentyone";
import { retailerPage } from "./retailer-http";
import { sportsListing, sportsOffers } from "./sportsdirect";
import { misterListing, misterOffers } from "./misterrunning";
import { warehouseListing, warehouseOffers } from "./warehouse";
export const pagedRetailers = {
  sportsdirect: {
    seeds: ["https://ie.sportsdirect.com/sale/running/shoes"],
    listing: sportsListing,
    product: sportsOffers,
  },
  misterrunning: {
    seeds: [
      "https://www.misterrunning.com/en/mens-running-shoes/",
      "https://www.misterrunning.com/en/womens-running-shoes/",
    ],
    listing: misterListing,
    product: misterOffers,
  },
  warehouse: {
    seeds: [
      "https://www.runningwarehouse.eu/catpage-RWMRSSALE.html",
      "https://www.runningwarehouse.eu/catpage-RWWRSSALE.html",
    ],
    listing: warehouseListing,
    product: warehouseOffers,
  },
};
export async function retailerStep(
  id: keyof typeof pagedRetailers,
  cursor: CrawlCursor | null,
  now: string,
) {
  const connector = pagedRetailers[id],
    state: CrawlCursor = cursor
      ? structuredClone(cursor)
      : {
          pageUrl: connector.seeds[0],
          pendingPages: connector.seeds.slice(1),
          queue: [],
          seen: [],
          seenPages: [],
          fingerprints: [],
          pages: 0,
          products: 0,
          held: 0,
          createdAt: now,
        },
    offers: Offer[] = [];
  if (!state.queue.length && state.pageUrl) {
    if (state.seenPages?.includes(state.pageUrl))
      throw new Error("Retailer pagination repeated a page; snapshot withheld");
    const page = connector.listing(
        await retailerPage(state.pageUrl),
        state.pageUrl,
      ),
      fingerprint =
        new URL(state.pageUrl).pathname +
        ":" +
        new Bun.CryptoHasher("sha256")
          .update(
            "fingerprint" in page
              ? String(page.fingerprint)
              : [...page.products].sort().join("\n"),
          )
          .digest("hex");
    if (state.fingerprints?.includes(fingerprint))
      throw new Error(
        "Retailer returned duplicate catalogue content; snapshot withheld",
      );
    (state.seenPages ??= []).push(state.pageUrl);
    (state.fingerprints ??= []).push(fingerprint);
    state.queue = page.products
      .filter((url) => !state.seen.includes(url))
      .map((url) => ({ url, sku: "" }));
    state.seen.push(...state.queue.map((p) => p.url));
    state.pages++;
    state.pageUrl = page.next ?? state.pendingPages?.shift() ?? null;
  }
  // A checkpoint budget, never a catalogue-size/product-name limit.
  for (let n = 0; n < 4 && state.queue.length; n++) {
    const item = state.queue[0];
    let html: string;
    try {
      html = await retailerPage(item.url, { irelandVAT: id === "warehouse" });
    } catch (error) {
      if (
        !/^Retailer HTTP (301|302|303|307|308|404|410)$/.test(
          (error as Error).message,
        )
      )
        throw error;
      state.held++;
      state.products++;
      state.queue.shift();
      continue;
    }
    try {
      const rows = connector.product(html, item.url, now);
      offers.push(...rows);
      if (!rows.length) state.held++;
    } catch (error) {
      state.rejected = (state.rejected ?? 0) + 1;
      (state.issues ??= []).length < 10 &&
        state.issues!.push({
          sku: "",
          url: item.url,
          reason: (error as Error).message.slice(0, 200),
        });
    }
    state.products++;
    state.queue.shift();
    if ((state.rejected ?? 0) > Math.max(3, state.products * 0.05))
      throw new ProductValidationError(
        "Over 5% of retailer products failed validation; snapshot withheld",
      );
  }
  const done = !state.pageUrl && !state.queue.length;
  if (done && (state.rejected ?? 0) > state.products * 0.05)
    throw new ProductValidationError(
      "Over 5% of retailer products failed validation; snapshot withheld",
    );
  return { offers, cursor: state, done };
}
