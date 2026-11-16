import type { Offer } from "./types";
import { retailerPage } from "./retailer-http";
const origin = "https://ie.sportsdirect.com";
export function sportsLink(value: string) {
  const u = new URL(value, origin);
  if (
    u.origin !== origin ||
    !/^\/[a-z0-9-]+(?:\/[a-z0-9-]+)*-\d{6}$/.test(u.pathname) ||
    /^\/(?:api|account|checkout|cart)(?:\/|$)/.test(u.pathname) ||
    u.search ||
    (u.hash && !/^#colcode=\d{8}$/.test(u.hash))
  )
    throw new Error("Unapproved Sports Direct product link");
  return u.href;
}
function structured(html: string) {
  return [
    ...html.matchAll(
      /<script\b[^>]*type="application\/ld\+json"[^>]*>([\s\S]*?)<\/script>/g,
    ),
  ].map((m) => JSON.parse(m[1]));
}
export function sportsGroup(html: string): any {
  // React Flight payloads contain JSON data, never executable parser input.
  // Decode string records; never eval page scripts.
  const records = [
    ...html.matchAll(/self\.__next_f\.push\((\[[\s\S]*?\])\)<\/script>/g),
  ]
    .flatMap((m) => {
      const value = JSON.parse(m[1]);
      return typeof value[1] === "string" ? [value[1]] : [];
    })
    .join("");
  // Flight text records have byte lengths and need not end in a newline.
  // Read only the balanced productGroup JSON object, respecting quoted braces.
  const marker = '"productGroup":{',
    start = records.indexOf(marker) + marker.length - 1;
  if (start >= marker.length - 1) {
    let depth = 0,
      quoted = false,
      escaped = false;
    for (let i = start; i < records.length; i++) {
      const c = records[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (c === "\\") escaped = true;
        else if (c === '"') quoted = false;
        continue;
      }
      if (c === '"') quoted = true;
      else if (c === "{") depth++;
      else if (c === "}" && --depth === 0) {
        const group = JSON.parse(records.slice(start, i + 1));
        if (Array.isArray(group.products) && group.products.length)
          return group;
        break;
      }
    }
  }
  throw new Error("Sports Direct product/variant contract missing");
}
export function sportsOffers(html: string, url: string, now: string): Offer[] {
  const link = new URL(sportsLink(url)),
    id = link.pathname.match(/(\d{6})$/)![1],
    group = sportsGroup(html),
    schema = structured(html).find((j) =>
      ["ProductGroup", "Product"].includes(j["@type"]),
    );
  if (
    !(schema?.["@type"] === "ProductGroup"
      ? String(schema.productGroupID) === id
      : String(schema?.sku ?? "").startsWith(id)) ||
    new URL(schema.url).pathname !== link.pathname
  )
    throw new Error("Sports Direct product identity mismatch");
  const offers: Offer[] = [];
  for (const product of group.products) {
    const a = product.attributes ?? {},
      identity = `${product.name} ${a.gender} ${a.subCategory}`.toLowerCase();
    if (
      product.styleCode !== id ||
      !/^\d{8}$/.test(product.key) ||
      !product.key.startsWith(id) ||
      typeof a.brand !== "string" ||
      !Array.isArray(product.variants)
    )
      throw new Error("Sports Direct colour identity mismatch");
    if (
      a.activity !== "Running" ||
      a.category !== "Footwear" ||
      /spikes|sandals|slides/.test(identity)
    )
      continue;
    const fit = /kids|junior|boys|girls|infant|youth/.test(identity)
      ? "kids"
      : /women|ladies/.test(identity)
        ? "women"
        : /unisex/.test(identity)
          ? "unisex"
          : /\bmen/.test(identity)
            ? "men"
            : "unknown";
    if (fit === "unknown") continue;
    const colourSchema =
      schema["@type"] === "Product"
        ? schema
        : schema.hasVariant?.find((v: any) => v.sku === product.key);
    if (
      !colourSchema ||
      colourSchema.sku !== product.key ||
      colourSchema.offers?.priceCurrency !== "EUR"
    )
      throw new Error("Sports Direct EUR colour offer missing");
    for (const variant of product.variants) {
      const price = variant.price?.value,
        reference = variant.ticketPrice?.value,
        size = String(variant.size).match(
          /^(\d+(?:\.5)?)(?:\s*\([\d.]+\))?$/,
        )?.[1];
      if (!size) continue;
      if (
        typeof variant.sku !== "string" ||
        !variant.sku.startsWith(product.key) ||
        typeof variant.isOnStock !== "boolean" ||
        !Number.isInteger(variant.availableQuantity) ||
        price?.currency !== "EUR" ||
        !Number.isSafeInteger(price.centAmount) ||
        price.centAmount <= 0 ||
        price.centAmount > 150000
      )
        throw new Error("Sports Direct size/price/stock contract changed");
      if (
        reference &&
        (reference.currency !== "EUR" ||
          !Number.isSafeInteger(reference.centAmount) ||
          reference.centAmount < 0)
      )
        throw new Error("Sports Direct reference currency mismatch");
      const image =
        variant.images?.find((i: any) => i.type === "MAIN")?.url ??
        product.firstVariant?.mainImage?.url;
      if (
        typeof image !== "string" ||
        new URL(image).origin !== "https://cdn.media.amplience.net"
      )
        throw new Error("Sports Direct image missing");
      const colourUrl = sportsLink(new URL(a.url, origin).href);
      if (
        new URL(colourUrl).pathname !== link.pathname ||
        new URL(colourUrl).hash !== `#colcode=${product.key}`
      )
        throw new Error("Sports Direct colour link mismatch");
      offers.push({
        id: `sportsdirect:${variant.sku}`,
        source_id: "sportsdirect",
        product_id: id,
        title: `${a.brand} ${product.name}`,
        brand: a.brand.toUpperCase(),
        category: /trail/.test(identity)
          ? "trail"
          : /stable|stability|support/.test(identity)
            ? "stability"
            : /race|racing/.test(identity)
              ? "race"
              : /road|neutral/.test(identity)
                ? "daily"
                : "unknown",
        fit,
        // The Ireland storefront labels these as shop sizes (e.g. 4 (37.5)).
        // Never infer UK/US/EU solely from a number or a parenthesis.
        size_system: "unknown",
        size: String(Number(size)),
        colour: String(a.color ?? ""),
        price: price.centAmount,
        reference_price:
          reference?.centAmount > price.centAmount
            ? reference.centAmount
            : null,
        currency: "EUR",
        image,
        url: colourUrl,
        available:
          variant.isOnStock &&
          variant.availableQuantity > 0 &&
          !variant.preorderAvailableDate
            ? 1
            : 0,
        checked_at: now,
      });
    }
  }
  return offers;
}
export async function sportsProduct(url: string, now: string) {
  const u = new URL(sportsLink(url));
  u.hash = "";
  return sportsOffers(await retailerPage(u.href), url, now);
}
export function sportsListing(html: string, url: string) {
  const listing = structured(html).find((j) => j["@type"] === "ItemList");
  if (
    !Array.isArray(listing?.itemListElement) ||
    !listing.itemListElement.length
  )
    throw new Error("Sports Direct listing contract missing");
  const listed = [...html.matchAll(/href="([^"?]+-\d{6}#colcode=\d{8})"/g)].map(
    (m) => new URL(m[1], origin).href,
  );
  // SEO JSON-LD contains only ten examples; the rendered catalogue has more.
  // Read every product-card link, with JSON-LD as a contract/fallback check.
  const discovered = listed.length
    ? listed
    : listing.itemListElement.map((v: any) => v.item.url);
  const products = [
    ...new Set<string>(
      discovered
        .filter((value: string) => !/spikes|sandals|slides/i.test(value))
        .map((value: string) => {
          const u = new URL(sportsLink(value));
          u.hash = "";
          return u.href;
        }),
    ),
  ];
  const tag = [...html.matchAll(/<a\b[^>]*>/g)].find(
      (m) =>
        /aria-label="Go To Next Page"/.test(m[0]) &&
        /href=/.test(m[0]) &&
        !/aria-disabled="true"/.test(m[0]) &&
        !(/class="[^"]*\b[\w-]*disabled\b/.test(m[0]) && /tabindex="-1"/.test(m[0])),
    )?.[0],
    href = tag?.match(/href="([^"]+)"/)?.[1],
    next = href ? new URL(href.replaceAll("&amp;", "&"), url) : null,
    current = new URL(url);
  if (
    next &&
    (next.origin !== origin ||
      next.pathname !== current.pathname ||
      !/^\?dcp=[1-9]\d*$/.test(next.search) ||
      Number(next.searchParams.get("dcp")) <=
        Number(current.searchParams.get("dcp") ?? 1))
  )
    throw new Error("Sports Direct pagination did not advance");
  return { products, next: next?.href ?? null };
}
