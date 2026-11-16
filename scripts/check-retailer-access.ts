import { retailerPage } from "../src/retailer-http";
import { pagedRetailers } from "../src/retailer-crawl";
for (const id of ["sportsdirect", "warehouse"] as const) {
  try {
    const shop = pagedRetailers[id],
      html = await retailerPage(shop.seeds[0]),
      page = shop.listing(html, shop.seeds[0]);
    const product = page.products[0];
    if (!product) throw new Error("No public product discovered");
    const rows = shop.product(
      await retailerPage(product, { irelandVAT: id === "warehouse" }),
      product,
      new Date().toISOString(),
    );
    console.log({
      source: id,
      access: "ok",
      discovered: page.products.length,
      next: page.next,
      verifiedVariants: rows.length,
      availableVariants: rows.filter((o) => o.available).length,
    });
  } catch (error) {
    console.log({
      source: id,
      access: "blocked",
      error: (error as Error).message,
    });
  }
}
