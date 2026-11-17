import type { Offer } from "./types";
import { retailerPage, RetailerRequestError } from "./retailer-http";
const decode = (s: string) =>
  s.replace(/&(?:amp|apos|quot|lt|gt|euro|nbsp|#39|#\d+);/g, (x) =>
    x.startsWith("&#")
      ? String.fromCodePoint(Number(x.slice(2, -1)))
      : ({
          "&amp;": "&",
          "&apos;": "'",
          "&#39;": "'",
          "&quot;": '"',
          "&lt;": "<",
          "&gt;": ">",
          "&euro;": "€",
          "&nbsp;": " ",
        }[x] ?? x),
  );
const text = (s: string) =>
  decode(s.replace(/<[^>]+>/g, " "))
    .replace(/\s+/g, " ")
    .trim();
const attr = (s: string, name: string) =>
  decode(s.match(new RegExp(`(?:^|[\\s"'])${name}="([^"]*)"`))?.[1] ?? "");
export function misterLink(value: string) {
  const u = new URL(value, "https://www.misterrunning.com");
  if (
    u.origin !== "https://www.misterrunning.com" ||
    !/^\/en\/[a-z0-9-]+\.html$/.test(u.pathname) ||
    u.search ||
    u.hash
  )
    throw new Error("Unapproved MisterRunning product URL");
  return u.href;
}
export function misterOffers(html: string, url: string, now: string): Offer[] {
  misterLink(url);
  const title = text(html.match(/<title>([^<]+)<\/title>/i)?.[1] ?? "").replace(
      /\s*[|–]\s*Mister.*$/i,
      "",
    ),
    id = html.match(/id="product_id"[^>]*value="(\d+)"/)?.[1],
    sku = html.match(/itemprop="sku" content="([^"]+)"/)?.[1],
    brand = html.match(
      /itemprop="brand"[\s\S]*?<meta itemprop="name" content="([^"]+)"/,
    )?.[1],
    price = html.match(/itemprop="price" content="(\d+\.\d{2})"/)?.[1],
    original = text(
      html.match(/class="first_price">([\s\S]*?)<\/span>\s*<\/span>/)?.[1] ??
        "",
    ).match(/(\d+(?:[.,]\d{2}))/)?.[1];
  if (
    !id ||
    !sku ||
    !brand ||
    !title ||
    !price ||
    !html.includes('itemprop="priceCurrency" content="EUR"')
  )
    throw new Error("MisterRunning identity/price/currency missing");
  if (
    !new URL(url).pathname.endsWith(
      "-" + sku.toLowerCase().replace(/[^a-z0-9]+/g, "-") + ".html",
    )
  )
    throw new Error("MisterRunning product identity mismatch");
  const identity = (
      title +
      " " +
      text(
        html.match(
          /<h1\b[^>]*class="[^"]*prod_name[^>]*>([\s\S]*?)<\/h1>/,
        )?.[1] ?? "",
      )
    ).toLowerCase(),
    fit = /kids|junior|boys|girls|youth/.test(identity)
      ? "kids"
      : /women|ladies/.test(identity)
        ? "women"
        : /unisex/.test(identity)
          ? "unisex"
          : /\bmen/.test(identity)
            ? "men"
            : "unknown";
  if (
    !/shoes/.test(identity) ||
    /spikes|sandals|slides/.test(identity) ||
    fit === "unknown"
  )
    return [];
  const image = decode(
    html.match(/property="og:image" content="([^"]+)"/)?.[1] ?? "",
  );
  if (!image.startsWith("https://www.misterrunning.com/"))
    throw new Error("MisterRunning image missing");
  const amount = Math.round(Number(price) * 100),
    reference = original
      ? Math.round(Number(original.replace(",", ".")) * 100)
      : null;
  if (
    amount <= 0 ||
    amount > 150000 ||
    (reference !== null && (reference <= 0 || reference > 150000))
  )
    throw new Error("MisterRunning invalid price");
  const colour = text(
    html.match(/<span class="color_str">([\s\S]*?)<\/span>/)?.[1] ?? "",
  );
  const category = /trail/.test(identity)
    ? "trail"
    : /structured|stability|support/.test(identity)
      ? "stability"
      : /racing|race/.test(identity)
        ? "race"
        : /neutral|road/.test(identity)
          ? "daily"
          : "unknown";
  const rows = [
    ...html.matchAll(
      /<button\b[^>]*class="[^"]*\bopt\b[^>]*>[\s\S]*?<\/button>/g,
    ),
  ];
  const model = text(
    html.match(/<span class="name_bold">([\s\S]*?)<\/span>/)?.[1] ?? "",
  );
  const width = identity.match(
    /\b(?:[246]e|extra[ -]?wide|wide|narrow)\b/,
  )?.[0];
  const displayTitle = model
    ? `${decode(brand)} ${model}${width && !model.toLowerCase().includes(width) ? " " + width : ""}`
    : title;
  if (!rows.length) throw new Error("MisterRunning size contract missing");
  return rows.flatMap((m) => {
    const size = attr(m[0], "data-UK"),
      variant = attr(m[0], "value_opt");
    if (!/^\d+(?:\.5)?$/.test(size) || !/^\d+$/.test(variant)) return [];
    const available =
      /\bopt_on\b/.test(attr(m[0], "class")) && />\s*Available\s*</i.test(m[0]);
    return [
      {
        id: `misterrunning:${id}:${variant}`,
        source_id: "misterrunning",
        product_id: id,
        title: displayTitle,
        brand: decode(brand).toUpperCase(),
        fit,
        category,
        size_system: "UK",
        size: String(Number(size)),
        colour,
        price: amount,
        reference_price: reference && reference > amount ? reference : null,
        currency: "EUR",
        image,
        url,
        available: available ? 1 : 0,
        checked_at: now,
      },
    ];
  });
}
export async function misterProduct(url: string, now: string) {
  return misterOffers(await retailerPage(misterLink(url)), url, now);
}
export function misterListing(html: string, url: string) {
  const anchors = [...html.matchAll(/<a\b[^>]*>/g)]
    .map((m) => m[0])
    .filter((a) => /data-products-price=/.test(a));
  const observed = new Set<string>(),
    products = new Set<string>();
  const amount = (value: string) => {
    const m = text(value).match(/^€\s*(\d+(?:[.,]\d{2}))$/);
    return m ? Math.round(Number(m[1].replace(",", ".")) * 100) : null;
  };
  for (const a of anchors) {
    const link = misterLink(attr(a, "href"));
    if (!/shoes/.test(link)) continue;
    observed.add(link);
    const current = amount(attr(a, "data-products-price")),
      previous = amount(attr(a, "data-products-price-old"));
    if (current === null || current <= 0)
      throw new Error("MisterRunning catalogue EUR price changed");
    // Discover all colours on every page, but fetch stock only for real sales.
    if (previous && current * 100 <= previous * 80) products.add(link);
  }
  // Single-colour cards have no colour-selector price attributes. Read the
  // actual product grid too; navigation/recommendation links are not products.
  const open=html.match(/<ul\b[^>]*\bid="product-list"[^>]*>/);
  if(open){
    const rest=html.slice(open.index!+open[0].length);let depth=1,end=-1;
    for(const tag of rest.matchAll(/<\/?ul\b[^>]*>/gi)){
      depth+=tag[0].startsWith('</')?-1:1;if(!depth){end=tag.index!;break;}
    }
    if(end<0)throw new Error('MisterRunning product grid is incomplete');
    const grid=rest.slice(0,end),starts=[...grid.matchAll(/<li\b[^>]*class="item(?: [^"]*)?"[^>]*>/g)];
    for(let i=0;i<starts.length;i++){
      if(!/\bdata-pid="\d+"/.test(starts[i][0]))continue;
      const card=grid.slice(starts[i].index!,starts[i+1]?.index??grid.length);
      const href=card.match(/<a\b[^>]*href="([^"]+)"/)?.[1];
      if(!href)throw new Error('MisterRunning product-card link missing');
      const link=misterLink(decode(href));if(!/shoes/.test(link))continue;
      const current=amount(card.match(/<span class="data_price">([\s\S]*?)<\/span>/)?.[1]??'');
      const previous=amount(card.match(/<span class="special">\s*<i>([\s\S]*?)<\/i>/)?.[1]??'');
      if(current===null)throw new Error('MisterRunning product-card EUR price missing');
      observed.add(link);if(previous&&current*100<=previous*80)products.add(link);
    }
  }
  if(!observed.size)throw new Error('MisterRunning catalogue price contract missing');
  const tag = [...html.matchAll(/<a\b[^>]*>/g)].find((m) =>
      /rel="next"/.test(m[0]),
    )?.[0],
    next = tag ? new URL(attr(tag, "href"), url) : null,
    current = new URL(url);
  const pager = text(
    html.match(/<ul class="pagination[^>]*>([\s\S]*?)<\/ul>/)?.[1] ?? "",
  ).match(/(\d+)\s+(?:di|of)\s+(\d+)/i);
  const finalPage =
    !!pager &&
    pager[1] === pager[2] &&
    Number(pager[1]) === Number(current.searchParams.get("p") ?? 1);
  if(pager&&Number(pager[1])!==Number(current.searchParams.get('p')??1))
    throw new RetailerRequestError(`MisterRunning returned page ${pager[1]} instead of ${current.searchParams.get('p')??1}`,true);
  if (next)
    for (const key of [...next.searchParams.keys()])
      if (/^(?:utm_|_gl$|_ga(?:_|$)|_gac_|gad_|gclid$|gclsrc$|fbclid$|msclkid$|srsltid$|wbraid$|gbraid$)/i.test(key))
        next.searchParams.delete(key);
  if (
    next &&
    !finalPage &&
    (next.origin !== current.origin ||
      next.pathname !== current.pathname ||
      !/^\?p=[1-9]\d*$/.test(next.search) ||
      Number(next.searchParams.get("p")) <=
        Number(current.searchParams.get("p") ?? 1))
  )
    throw new RetailerRequestError(`MisterRunning pagination did not advance (page=${current.searchParams.get('p')??1}; next=${next?.pathname}; keys=${[...(next?.searchParams.keys()??[])].join(',')}; nextPage=${next?.searchParams.get('p')})`,true);
  return {
    products: [...products],
    next: finalPage ? null : (next?.href ?? null),
    fingerprint: [...observed].sort().join("\n"),
  };
}
