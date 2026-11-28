import type { Offer } from './types';
const origin = 'https://21run.com',
  ua = 'Lacey/0.4 (+https://lacey.january.ie; twice-daily shoe-price checks)';
const requestIntervalMs = 1000;
// A bad product can be withheld; a network failure must not drop that product.
export class ProductValidationError extends Error {}
export class RetryableRequestError extends Error {}
const decode = (s: string) =>
  s.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi, (x) =>
    x.startsWith('&#')
      ? String.fromCodePoint(
          parseInt(x.slice(x[2] === 'x' ? 3 : 2, -1), x[2] === 'x' ? 16 : 10),
        )
      : ({
          '&amp;': '&',
          '&quot;': '"',
          '&apos;': "'",
          '&lt;': '<',
          '&gt;': '>',
        }[x] ?? x),
  );
const attribute = (tag: string, key: string) =>
  decode(tag.match(new RegExp(`(?:^|\\s)${key}="([^"]*)"`))?.[1] ?? '');
export function twentyOneLink(url: string) {
  const u = new URL(url);
  if (
    u.origin !== origin ||
    !/^\/eu\/[a-z0-9][a-z0-9-]+$/.test(u.pathname) ||
    u.search ||
    u.hash
  )
    throw new Error('21RUN product URL is not approved');
  return u.href;
}
export function robotsAllows(text: string, path: string) {
  const groups: {
    agents: string[];
    rules: { allow: boolean; path: string }[];
  }[] = [];
  let g: { agents: string[]; rules: { allow: boolean; path: string }[] } = {
    agents: [],
    rules: [],
  };
  for (const line of text.replaceAll('\\r\\n', '\n').split(/\r?\n/)) {
    const m = line
      .split('#')[0]
      .trim()
      .match(/^([\w-]+):\s*(.*)$/);
    if (!m) continue;
    const key = m[1].toLowerCase(),
      value = m[2].trim();
    if (key === 'user-agent') {
      if (g.rules.length) {
        groups.push(g);
        g = { agents: [], rules: [] };
      }
      g.agents.push(value.toLowerCase());
    } else if ((key === 'allow' || key === 'disallow') && value)
      g.rules.push({ allow: key === 'allow', path: value });
  }
  groups.push(g);
  const named = groups.filter((x) =>
      x.agents.some((a) => a !== '*' && 'lacey'.includes(a)),
    ),
    relevant = named.length
      ? named
      : groups.filter((x) => x.agents.includes('*'));
  const rules = relevant
    .flatMap((x) => x.rules)
    .filter((r) =>
      new RegExp(
        '^' +
          r.path
            .split('*')
            .map((p) => p.replace(/[.+?^{}()|[\]\\]/g, '\\$&'))
            .join('.*')
            .replace(/\\\$$/, '$'),
      ).test(path),
    )
    .sort(
      (a, b) =>
        b.path.length - a.path.length || Number(b.allow) - Number(a.allow),
    );
  return rules[0]?.allow ?? true;
}
let queue: Promise<unknown> = Promise.resolve(),
  nextRequest = 0,
  blockedUntil = 0;
async function request(url: string, policy?: string) {
  const work = queue.then(async () => {
    if (Date.now() < blockedUntil)
      throw new Error('21RUN paused after blocked/rate-limited response');
    const link = new URL(url);
    if (
      link.origin !== origin ||
      link.hash ||
      (link.search && !/^\?p=[1-9]\d*$/.test(link.search))
    )
      throw new Error('21RUN request is not approved');
    if (policy && !robotsAllows(policy, link.pathname + link.search))
      throw new Error('21RUN robots.txt disallows this request');
    await Bun.sleep(Math.max(0, nextRequest - Date.now()));
    nextRequest = Date.now() + requestIntervalMs;
    let response: Response;
    try {
      response = await fetch(link, {
      headers: { 'User-Agent': ua, Accept: 'text/html,application/json' },
      redirect: 'error',
      signal: AbortSignal.timeout(15000),
      });
    } catch {
      throw new RetryableRequestError('21RUN request timed out or failed to connect');
    }
    if ([401, 403, 406, 429].includes(response.status)) {
      blockedUntil = Date.now() + 12 * 3600000;
      await response.body?.cancel();
      throw new Error(
        `21RUN paused: HTTP ${response.status}; no automatic retry for 12 hours`,
      );
    }
    if (!response.ok) {
      await response.body?.cancel();
      if (response.status >= 500)
        throw new RetryableRequestError(`21RUN HTTP ${response.status}`);
      throw new Error(`21RUN HTTP ${response.status}`);
    }
    try {
      return await response.text();
    } catch {
      throw new RetryableRequestError('21RUN response body was interrupted');
    }
  });
  queue = work.catch(() => {});
  return work;
}
// Share one robots policy between catalogue steps and product checks. Keep the
// cache tied to the fetch transport so isolated test workers cannot share it.
let policyCache: { fetcher: typeof fetch; until: number; text: Promise<string> } | undefined;
function robotsPolicy() {
  if (policyCache?.fetcher === fetch && policyCache.until > Date.now())
    return policyCache.text;
  const entry = {
    fetcher: fetch,
    until: Date.now() + 30 * 60000,
    text: request(`${origin}/robots.txt`),
  };
  policyCache = entry;
  void entry.text.catch(() => {
    if (policyCache === entry) policyCache = undefined;
  });
  return entry.text;
}
interface Size {
  attribute_code: string;
  label: { content: string };
}
interface Variant {
  sku: string;
  parent_sku: string;
  brand: string;
  name: string;
  color: string;
  gender: string;
  is_available: number;
  stock: { qty: number; is_in_stock: number; backorder_mode: number };
  sizes: Size[];
}
interface SizeResponse {
  products: Variant[];
  size_table?: string;
}
interface ParentProduct {
  sku: string;
  preselected_sku: string;
  title: string;
  product_url: string;
  price: { currency: string; price: number; special_price?: number };
  sizes: Size[];
  frontend_attributes: { label: string; value: string }[];
  gallery: { img: string; is_main: boolean }[];
}
function cents(n: unknown) {
  if (
    typeof n !== 'number' ||
    !Number.isFinite(n) ||
    n <= 0 ||
    n > 1500 ||
    Math.abs(n * 100 - Math.round(n * 100)) > 0.00001
  )
    throw new Error('21RUN invalid price');
  return Math.round(n * 100);
}
export function twentyOneOffers(
  url: string,
  sku: string,
  data: unknown,
  parent: unknown,
  now: string,
): Offer[] {
  try {
    return parseOffers(url, sku, data, parent, now);
  } catch (error) {
    throw new ProductValidationError((error as Error).message);
  }
}
function parseOffers(
  url: string,
  sku: string,
  data: unknown,
  parent: unknown,
  now: string,
): Offer[] {
  const canonical = twentyOneLink(url),
    d = data as SizeResponse;
  if (!Array.isArray(d?.products) || !d.products.length)
    throw new Error('21RUN size contract changed');
  const uk = new Map<string, string>();
  for (const m of (d.size_table ?? '').matchAll(
    /<tr\b[^>]*>([\s\S]*?)<\/tr>/gi,
  )) {
    const cells = [...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((x) =>
      decode(x[1].replace(/<[^>]+>/g, ''))
        .trim()
        .replace(',', '.'),
    );
    if (
      cells.length === 4 &&
      /^\d+(?:\.\d+| [12]\/3)?$/.test(cells[0]) &&
      /^\d+(?:\.5)?$/.test(cells[2]) &&
      Number(cells[2]) > 0 &&
      Number(cells[2]) <= 20
    )
      uk.set(cells[0], String(Number(cells[2])));
  }
  if (
    uk.size &&
    !/<th[^>]*>\s*EU\s*<\/th>[\s\S]*?<th[^>]*>\s*US\s*<\/th>[\s\S]*?<th[^>]*>\s*UK\s*<\/th>/i.test(
      d.size_table ?? '',
    )
  )
    throw new Error('21RUN size table headers changed');
  const p = parent as ParentProduct;
  if (
    p?.sku !== sku ||
    twentyOneLink(p.product_url) !== canonical ||
    !Array.isArray(p.frontend_attributes) ||
    !Array.isArray(p.sizes) ||
    !p.title
  )
    throw new Error('21RUN product identity mismatch');
  const preselected = d.products.find((v) => v.sku === p.preselected_sku);
  if (
    !preselected ||
    !p.sizes.every((s) =>
      preselected.sizes.some(
        (v) =>
          v.attribute_code === s.attribute_code &&
          s.label.content.replace(/\s*(EU|US)$/, '') === v.label.content,
      ),
    )
  )
    throw new Error('21RUN selected size mismatch');
  if (p.price?.currency !== 'EUR') throw new Error('21RUN currency mismatch');
  const regular = cents(p.price.price),
    price =
      p.price.special_price == null ? regular : cents(p.price.special_price);
  if (price > regular) throw new Error('21RUN contradictory price');
  const group =
    p.frontend_attributes.find((a) => a.label === 'Article group')?.value ?? '';
  if (!/running shoes/i.test(group) || /spikes/i.test(group)) return [];
  const offers: Offer[] = [];
  const seen = new Set<string>();
  for (const v of d.products) {
    if (v.parent_sku !== sku || !Array.isArray(v.sizes) || !v.brand || !v.color)
      throw new Error('21RUN product identity mismatch');
    if (seen.has(v.sku)) throw new Error('21RUN duplicate variant');
    seen.add(v.sku);
    const eu = v.sizes.find((s) => s.attribute_code === 'size_eu')?.label
      ?.content;
    if (!eu || !/^\d+(?:[.,]\d+| [12]\/3)?$/.test(eu))
      throw new Error('21RUN size missing');
    const euSize = eu.replace(',', '.');
    if (!uk.has(euSize) && !/^\d+(?:\.5)?$/.test(euSize)) continue;
    const gender = String(v.gender).toLowerCase(),
      fit = /kids|junior|child|boys|girls|youth/.test(gender)
        ? 'kids'
        : gender === 'women'
          ? 'women'
          : gender === 'men'
            ? 'men'
            : gender === 'unisex'
              ? 'unisex'
              : 'unknown';
    if (fit === 'unknown') throw new Error('21RUN department unknown');
    const attrs = new Map(p.frontend_attributes.map((a) => [a.label, a.value]));
    if (
      attrs.get('Article number') !== sku ||
      attrs.get('Brand')?.toUpperCase() !== v.brand.toUpperCase() ||
      attrs.get('Colour') !== v.color ||
      attrs.get('Gender') !== v.gender ||
      p.title !== v.name
    )
      throw new Error('21RUN metadata mismatch');
    const group = attrs.get('Article group') ?? '';
    if (!/running shoes/i.test(group) || /spikes/i.test(group)) continue;
    const category = /trail/i.test(group)
      ? 'trail'
      : /stability/i.test(attrs.get('Shoe type') ?? '')
        ? 'stability'
        : /race|competition/i.test(group)
          ? 'race'
          : /neutral/i.test(attrs.get('Shoe type') ?? '')
            ? 'daily'
            : 'unknown';
    const available =
      v.is_available === 1 &&
      v.stock?.is_in_stock === 1 &&
      typeof v.stock.qty === 'number' &&
      v.stock.qty > 0 &&
      v.stock.backorder_mode === 0;
    offers.push({
      id: `21run:${v.sku}`,
      source_id: '21run',
      product_id: sku,
      title: p.title,
      brand: v.brand.toUpperCase(),
      category,
      fit,
      size_system: uk.has(euSize) ? 'UK' : 'EU',
      size: uk.get(euSize) ?? euSize,
      colour: v.color,
      price,
      reference_price: regular > price ? regular : null,
      currency: 'EUR',
      image: p.gallery?.find((i) => i.is_main)?.img ?? '',
      url: canonical,
      available: available ? 1 : 0,
      checked_at: now,
    });
  }
  if (!offers.length)
    throw new Error('21RUN has no supported verified running-shoe variants');
  return offers;
}
async function product(
  url: string,
  now: string,
  policy: string,
  checkPage: boolean,
) {
  const canonical = twentyOneLink(url);
  // Discovery URLs come from the retailer's product JSON, whose SKU is checked
  // again in both API responses. Before email, GET the customer page as well.
  let id = '';
  if (checkPage) {
    const html = await request(canonical, policy),
      metas = [...html.matchAll(/<meta\b[^>]*>/g)].map((m) => m[0]);
    const sku = metas.find((t) => attribute(t, 'itemprop') === 'sku');
    id = sku ? attribute(sku, 'content') : '';
    const tag = html.match(/<link\b[^>]*rel="canonical"[^>]*>/)?.[0];
    if (!tag || attribute(tag, 'href') !== canonical)
      throw new Error('21RUN product page identity missing');
  }
  if (!id) throw new Error('21RUN manufacturer SKU is required');
  return loadProduct(canonical, id, now, policy);
}
async function loadProduct(
  url: string,
  id: string,
  now: string,
  policy: string,
) {
  if (!/^[A-Za-z0-9._-]+$/.test(id))
    throw new Error('21RUN invalid manufacturer SKU');
  const base = `${origin}/eu/rest/eu/V1/`;
  const data = JSON.parse(
    await request(`${base}sizeselector/sizeselector/${id}`, policy),
  ) as SizeResponse;
  if (!Array.isArray(data.products))
    throw new Error('21RUN size contract changed');
  const selected = data.products.find(
    (v) =>
      v.parent_sku === id &&
      v.is_available === 1 &&
      v.stock?.is_in_stock === 1 &&
      v.stock.qty > 0 &&
      v.stock.backorder_mode === 0,
  );
  if (!selected) return [];
  if (!/^[A-Za-z0-9._-]+$/.test(selected.sku))
    throw new Error('21RUN invalid variant SKU');
  // This storefront prices a parent colourway, not each size. Its size picker
  // changes size/delivery only; the product-offer response carries that price.
  const parent = JSON.parse(
    await request(
      `${base}product-offer/product-alternative/${id}/${selected.sku}`,
      policy,
    ),
  );
  return twentyOneOffers(url, id, data, parent, now);
}
export async function twentyOneProduct(url: string, now: string) {
  return product(url, now, await robotsPolicy(), true);
}
export interface CatalogueProduct {
  url: string;
  sku: string;
}
export interface CrawlCursor {
  snapshot?: string;
  pendingPages?: string[];
  seenPages?: string[];
  fingerprints?: string[];
  pageUrl: string | null;
  queue: CatalogueProduct[];
  seen: string[];
  pages: number;
  products: number;
  held: number;
  inventory?:{products:number;variants:number;availableProducts:number;soldOutProducts:number};
  rejected?: number;
  issues?: { sku: string; url: string; reason: string }[];
  createdAt: string;
}
export function twentyOnePage(html: string, pageUrl: string) {
  const products: CatalogueProduct[] = [];
  for (const m of html.matchAll(/\sdata-product="([^"]+)"/g)) {
    const p = JSON.parse(decode(m[1]));
    if (
      typeof p.url !== 'string' ||
      typeof p.sku !== 'string' ||
      typeof p.price !== 'number'
    )
      throw new Error('21RUN catalogue contract changed');
    if (
      typeof p.special_price === 'number' &&
      p.special_price > 0 &&
      p.special_price <= p.price * 0.8
    )
      products.push({ url: twentyOneLink(p.url), sku: p.sku });
  }
  if (!/\sdata-product="/.test(html))
    throw new Error('21RUN catalogue product data missing');
  const tag = [...html.matchAll(/<a\b[^>]*>/g)].find((m) =>
    attribute(m[0], 'class').split(/\s+/).includes('pages-item-next') && attribute(m[0],'aria-disabled')!=='true',
  )?.[0];
  const next = tag ? new URL(attribute(tag, 'href'), pageUrl) : null;
  if (
    next &&
    (next.origin !== origin ||
      next.pathname !== new URL(pageUrl).pathname ||
      !/^\?p=[1-9]\d*$/.test(next.search) ||
      Number(next.searchParams.get('p')) <=
        Number(new URL(pageUrl).searchParams.get('p') ?? 1))
  )
    throw new Error('21RUN pagination did not advance');
  return { products, next: next?.href ?? null };
}
export async function twentyOneStep(cursor: CrawlCursor | null, now: string) {
  const state: CrawlCursor = cursor
    ? structuredClone(cursor)
    : {
        pageUrl: `${origin}/eu/sale/running-shoes`,
        queue: [],
        seen: [],
        pages: 0,
        products: 0,
        held: 0,
        createdAt: now,
      };
  const policy = await robotsPolicy(),
    offers: Offer[] = [];
  if (!state.queue.length && state.pageUrl) {
    const page = twentyOnePage(
      await request(state.pageUrl, policy),
      state.pageUrl,
    );
    state.queue = page.products.filter((p) => !state.seen.includes(p.url));
    state.seen.push(...state.queue.map((p) => p.url));
    state.pageUrl = page.next;
    state.pages++;
  }
  // This is an invocation budget, not a coverage limit. The next call resumes.
  for (let n = 0; n < 8 && state.queue.length; n++) {
    const item = state.queue[0];
    let rows: Offer[];
    try {
      rows = await loadProduct(item.url, item.sku, now, policy);
    } catch (e) {
      if (e instanceof ProductValidationError) {
        state.rejected = (state.rejected ?? 0) + 1;
        state.issues ??= [];
        if (state.issues.length < 10)
          state.issues.push({ ...item, reason: e.message.slice(0, 200) });
      } else if (!/^21RUN HTTP (404|410)$/.test((e as Error).message)) throw e;
      rows = [];
    }
    offers.push(...rows);
    state.products++;
    if (!rows.length) state.held++;
    state.queue.shift();
    // Isolate occasional bad listings, but do not hide a broken parser or feed.
    if ((state.rejected ?? 0) > Math.max(3, state.products * 0.05))
      throw new Error('21RUN over 5% of products failed validation; snapshot withheld');
  }
  if (!state.pageUrl && !state.queue.length &&
      (state.rejected ?? 0) > state.products * 0.05)
    throw new Error('21RUN over 5% of products failed validation; snapshot withheld');
  return { offers, cursor: state, done: !state.pageUrl && !state.queue.length };
}

// Catalogue parsing and collection are product-independent. Example payloads live
// only under fixtures/, and are never imported by production code.
