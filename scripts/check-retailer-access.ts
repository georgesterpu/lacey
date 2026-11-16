import { retailerPage } from "../src/retailer-http";
import { pagedRetailers } from "../src/retailer-crawl";
for (const id of ["sportsdirect", "warehouse"] as const) {
  try {
    const shop = pagedRetailers[id],
      html = await retailerPage(shop.seeds[0]),
      page = shop.listing(html, shop.seeds[0]);
    console.log({
      source: id,
      access: "ok",
      discovered: page.products.length,
      next: page.next,
    });
  } catch (error) {
    console.log({
      source: id,
      access: "blocked",
      error: (error as Error).message,
    });
  }
}
