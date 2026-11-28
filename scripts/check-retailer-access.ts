import { retailerPage } from "../src/retailer-http";
import { pagedRetailers } from "../src/retailer-crawl";
import { lifestyleListing, lifestyleSizes, lifestyleVariant } from "../src/lifestyle";
import {warehouseLink,warehouseProduct} from '../src/warehouse';
const selected=process.env.RETAILER_SOURCE??'all';
if(!['all','warehouse','sportsdirect','misterrunning','lifestyle'].includes(selected))throw new Error('Unknown retailer diagnostic');
for (const id of ["sportsdirect", "warehouse", "misterrunning", "lifestyle"] as const) {
  if(selected!=='all'&&selected!==id)continue;
  try {
    if (id === "lifestyle") {
      const entry = "https://www.lifestylesports.com/ie/c/mens/running-shoes/";
      const products = lifestyleListing(await retailerPage(entry));
      if (!products[0]) throw new Error("No public sale product discovered");
      const sizes = lifestyleSizes(await retailerPage(products[0]));
      if (!sizes[0]) throw new Error("No public size found");
      const offer = lifestyleVariant(await retailerPage(sizes[0]), sizes[0], new Date().toISOString());
      if (!offer?.image) throw new Error("No validated offer image found");
      const image = new URL(offer.image);
      if (image.origin !== new URL(entry).origin) throw new Error("Unexpected image origin");
      const response = await fetch(image, { redirect: "manual", signal: AbortSignal.timeout(12000) });
      const type = response.headers.get("Content-Type") ?? "";
      await response.body?.cancel();
      if (!response.ok || !type.startsWith("image/")) throw new Error(`Image HTTP ${response.status} (${type})`);
      console.log({ source: id, access: "ok", discovered: products.length, size: offer.size, image: response.status });
      continue;
    }
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
    if(id==='warehouse'&&process.env.RETAILER_PRODUCT_URL){
      const url=warehouseLink(process.env.RETAILER_PRODUCT_URL);
      const verified=await warehouseProduct(url,new Date().toISOString());
      console.log({source:id,sessionProduct:url,verifiedVariants:verified.length,availableVariants:verified.filter(o=>o.available).length});
    }
  } catch (error) {
    console.log({
      source: id,
      access: "blocked",
      error: (error as Error).message,
    });
  }
}
