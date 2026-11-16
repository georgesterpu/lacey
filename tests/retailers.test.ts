import { test, expect } from "bun:test";
import { misterOffers, misterLink, misterListing } from "../src/misterrunning";
import { sportsOffers, sportsLink, sportsListing } from "../src/sportsdirect";
import {
  warehouseOffers,
  warehouseLink,
  warehouseListing,
} from "../src/warehouse";
import { normalize, sources, validProductHandle } from "../src/sources";
import { shoeIdentity } from "../src/shoe-identity";
import unicodeProduct from "../fixtures/runhub-unicode.json";
const now = "2026-11-16T22:00:00Z",
  mr =
    "https://www.misterrunning.com/en/mizuno-wave-sky-9-mens-running-shoes-cloudscape-blue-jewel-j1gc2502-61.html",
  sd = "https://ie.sportsdirect.com/nike-structure-26-trainers-womens-211073";
test("real Unicode Shopify handles are encoded as one safe path segment and trademark marks do not change model identity", () => {
  const source = sources.find((s) => s.id === "runhub")!,
    rows = normalize(unicodeProduct, source, now);
  expect(rows.length).toBeGreaterThan(0);
  expect(rows[0].url).toContain("%E2%84%A2");
  for (const h of ["../other", "a/b", "a?x=1", "a%2fb", "a#fragment", "a\\b"])
    expect(validProductHandle(h)).toBe(false);
  const base = { ...rows[0], title: "Puma Deviate Nitro 3", fit: "men" };
  expect(shoeIdentity({ ...base, title: "Puma Deviate NITRO™ 3" }).key).toBe(
    shoeIdentity(base).key,
  );
});
test("Sports Direct single-colour JSON-LD and unseparated Flight text records preserve oversold stock as unavailable", async () => {
  const h = await Bun.file("fixtures/sportsdirect-single-product.html").text(),
    rows = sportsOffers(
      h,
      "https://ie.sportsdirect.com/nike-juniper-trail-2-gtx-mens-trail-running-shoes-213000",
      now,
    );
  expect(rows).toHaveLength(5);
  expect(rows.filter((r) => r.available)).toHaveLength(3);
  expect(rows.find((r) => r.size === "8")?.available).toBe(0);
});
test("MisterRunning uses the recorded UK size, stock and first-listed price, including adjacent HTML attributes", async () => {
  const html = await Bun.file("fixtures/misterrunning-product.html").text(),
    rows = misterOffers(html, mr, now);
  expect(rows.length).toBe(11);
  expect(rows[0]).toMatchObject({
    product_id: "64632",
    size_system: "UK",
    size: "7",
    price: 14250,
    reference_price: 19000,
    available: 1,
    fit: "men",
    category: "daily",
  });
  expect(rows.every((r) => r.url === mr)).toBe(true);
  expect(
    misterOffers(html.replaceAll("opt_on", "opt_off"), mr, now).every(
      (r) => !r.available,
    ),
  ).toBe(true);
  expect(() =>
    misterOffers(html.replace('content="142.50"', 'content="0.00"'), mr, now),
  ).toThrow("invalid price");
  expect(() =>
    misterOffers(html, mr.replace("j1gc2502-61", "wrong-sku"), now),
  ).toThrow("identity mismatch");
});
test("Sports Direct decodes server JSON without scripts and preserves colour, size-specific price and sold-out variants", async () => {
  const html = await Bun.file("fixtures/sportsdirect-product.html").text(),
    rows = sportsOffers(html, sd, now);
  expect(rows.length).toBe(6);
  expect(rows[0]).toMatchObject({
    size: "3.5",
    size_system: "unknown",
    available: 0,
    price: 11000,
    reference_price: 15000,
    colour: "Black/Pink",
  });
  expect(rows[1].available).toBe(1);
  expect(rows[0].url).toEndWith("#colcode=21107341");
  expect(new Set(rows.map((r) => r.colour)).size).toBe(2);
  expect(() => sportsOffers(html, sd.replace("211073", "999999"), now)).toThrow(
    "identity mismatch",
  );
  expect(() => sportsOffers(html.replaceAll("EUR", "USD"), sd, now)).toThrow(
    "EUR",
  );
  expect(() => sportsOffers("<script>throw 1</script>", sd, now)).toThrow(
    "contract missing",
  );
});
test("retailer URLs reject other countries, account/API routes and arbitrary queries", () => {
  expect(() => sportsLink(sd.replace("ie.", "www."))).toThrow();
  expect(() => sportsLink(sd + "?sizecode=123")).toThrow();
  expect(() =>
    sportsLink("https://ie.sportsdirect.com/api/products"),
  ).toThrow();
  expect(() => misterLink(mr.replace("/en/", "/it/"))).toThrow();
  const wh =
    "https://www.runningwarehouse.eu/adidas_adizero_Adios_Pro_4/descpage-A4AAPMR-EN.html";
  expect(warehouseLink(wh)).toBe(wh);
  expect(warehouseLink(wh + "?vat=IE")).toBe(wh);
  expect(() => warehouseLink(wh + "?vat=DE")).toThrow();
});
test("catalogue pagination follows the next page and cannot change country or repeat page numbers", () => {
  const m = `<a href="${mr}" data-products-price="€ 100,00" data-products-price-old="€ 160,00">Shoe</a><a rel="next" href="https://www.misterrunning.com/en/mens-running-shoes/?p=2">Next</a>`;
  expect(
    misterListing(m, "https://www.misterrunning.com/en/mens-running-shoes/")
      .products,
  ).toEqual([mr]);
  expect(
    misterListing(
      m.replace("?p=2", "?p=2&_gl=tracking&gclid=tracking"),
      "https://www.misterrunning.com/en/mens-running-shoes/",
    ).next,
  ).toBe("https://www.misterrunning.com/en/mens-running-shoes/?p=2");
  expect(() =>
    misterListing(
      m,
      "https://www.misterrunning.com/en/mens-running-shoes/?p=2",
    ),
  ).toThrow("advance");
  const s = `<script type="application/ld+json">${JSON.stringify({ "@type": "ItemList", itemListElement: [{ item: { name: "Running shoe", url: sd + "#colcode=21107341" } }, { item: { name: "Running shoe", url: sd + "#colcode=21107374" } }] })}</script><a aria-label="Go To Next Page" href="/sale/running/shoes?dcp=2">Next</a>`;
  expect(
    sportsListing(s, "https://ie.sportsdirect.com/sale/running/shoes"),
  ).toEqual({
    products: [sd],
    next: "https://ie.sportsdirect.com/sale/running/shoes?dcp=2",
  });
  expect(() =>
    sportsListing(s, "https://ie.sportsdirect.com/sale/running/shoes?dcp=2"),
  ).toThrow("advance");
  expect(
    warehouseListing(
      '<a href="/Shoe/descpage-ABC-EN.html">One</a><a href="/Shoe/descpage-ABC-EN.html">Again</a>',
    ).products,
  ).toEqual(["https://www.runningwarehouse.eu/Shoe/descpage-ABC-EN.html"]);
});
test("MisterRunning finishes only when its explicit current/total pager confirms the final page", () => {
  const product = `<a href="${mr}" data-products-price="€ 100,00" data-products-price-old="€ 160,00">Shoe</a>`,
    pager =
      '<ul class="pagination centered"><li><span class="current">32</span> di &nbsp; 32</li></ul>',
    next =
      '<a rel="next" href="https://www.misterrunning.com/en/mens-running-shoes/?p=32">Next</a>';
  expect(
    misterListing(
      product + pager + next,
      "https://www.misterrunning.com/en/mens-running-shoes/?p=32",
    ).next,
  ).toBeNull();
  expect(() =>
    misterListing(
      product + pager.replace("di &nbsp; 32", "di &nbsp; 33") + next,
      "https://www.misterrunning.com/en/mens-running-shoes/?p=32",
    ),
  ).toThrow("advance");
});
test("Sports Direct discovers rendered products beyond the truncated SEO sample", () => {
  const second = sd.replace("211073", "999999"),
    html = `<script type="application/ld+json">${JSON.stringify({ "@type": "ItemList", itemListElement: [{ item: { name: "Running shoe", url: sd + "#colcode=21107341" } }] })}</script><a href="${sd}#colcode=21107341">First</a><a href="${second}#colcode=99999901">Beyond SEO sample</a><a aria-label="Go To Next Page" aria-disabled="true" href="/sale/running/shoes">Next</a>`;
  expect(
    sportsListing(
      html,
      "https://ie.sportsdirect.com/sale/running/shoes?dcp=19",
    ),
  ).toEqual({ products: [sd, second], next: null });
});
test("Warehouse Ireland prices remain explicit, 3+ means stock, and delivery estimates do not mean in stock", async () => {
  const html = await Bun.file("fixtures/warehouse-product.html").text();
  const rows = warehouseOffers(
    html,
    "https://www.runningwarehouse.eu/Shoe/descpage-ABC-EN.html?vat=IE",
    now,
  );
  expect(rows.some((r) => r.available)).toBe(true);
  expect(rows.every((r) => !new URL(r.url).search)).toBe(true);
  expect(() =>
    warehouseOffers(
      html.replace('value="IE" selected', 'value="DE" selected'),
      "https://www.runningwarehouse.eu/Shoe/descpage-ABC-EN.html",
      now,
    ),
  ).toThrow("Ireland");
  const plus = html.replace(/class="available">\d+</g, 'class="available">3+<');
  expect(warehouseOffers(plus, rows[0].url, now).some((r) => r.available)).toBe(
    true,
  );
});
