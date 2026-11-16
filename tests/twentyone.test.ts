import { test, expect } from 'bun:test';
import {
  robotsAllows,
  twentyOneOffers,
  twentyOneLink,
  twentyOnePage,
} from '../src/twentyone';
import fixture from '../fixtures/twentyone-product.json';
const url = 'https://21run.com/eu/asics-novablast-6-men-1011c243-001';
test('the disabled Next anchor on the final 21RUN page ends the crawl, while an active backwards link fails',()=>{
 const base='https://21run.com/eu/sale/running-shoes',entry=JSON.stringify({sku:'test-sku',url,price:160,special_price:110}).replaceAll('"','&quot;'),product=`<div data-product="${entry}"></div>`,link=`<a class="pages-item-next pager-item" href="${base}" aria-disabled="true">Next</a>`;
 expect(twentyOnePage(product+link,base+'?p=79').next).toBeNull();
 expect(()=>twentyOnePage(product+link.replace('aria-disabled="true"',''),base+'?p=79')).toThrow('advance');
});
const parse = (f = structuredClone(fixture)) =>
  twentyOneOffers(
    url,
    '1011C243-001',
    f.sizes,
    f.parent,
    '2026-11-15T20:00:00.000Z',
  );
test('21RUN uses colourway price, all size stock and retailer UK conversion', () => {
  expect(parse()[0]).toMatchObject({
    source_id: '21run',
    product_id: '1011C243-001',
    price: 11995,
    reference_price: 15995,
    size_system: 'UK',
    size: '6',
    available: 1,
    colour: 'Black',
  });
  const f = structuredClone(fixture);
  f.parent.price.special_price = 129.95;
  expect(parse(f)[0].price).toBe(12995);
  f.sizes.products.find((p) => p.sku === f.parent.preselected_sku)!.stock.qty =
    0;
  expect(parse(f)[0].available).toBe(0);
});
test('21RUN never substitutes alternative colours, sizes, currencies or backorders', () => {
  for (const change of [
    (f: typeof fixture) => {
      f.parent.preselected_sku = '1011C243-402-7';
    },
    (f: typeof fixture) => {
      f.parent.sizes[0].label.content = '41 EU';
    },
    (f: typeof fixture) => {
      f.parent.price.currency = 'USD';
    },
    (f: typeof fixture) => {
      f.parent.frontend_attributes.find((a) => a.label === 'Colour')!.value =
        'Blue';
    },
  ]) {
    const f = structuredClone(fixture);
    change(f);
    expect(() => parse(f)).toThrow();
  }
  const f = structuredClone(fixture);
  f.sizes.products.find(
    (p) => p.sku === f.parent.preselected_sku,
  )!.stock.backorder_mode = 1;
  expect(parse(f)[0].available).toBe(0);
});
test('21RUN ignores misleading summary counts; no guessed size conversions', () => {
  const f = structuredClone(fixture);
  f.sizes.total_products = 0;
  f.sizes.size_table = '';
  expect(parse(f)[0]).toMatchObject({ size_system: 'EU', size: '40' });
});
test('21RUN respects robots wildcard rules and confines requests to clean retailer links', () => {
  const policy =
    'User-agent: *\nDisallow: /*?*=*\nDisallow: /eu/catalogsearch/\nAllow: /*?p=*';
  expect(
    robotsAllows(
      policy,
      '/eu/rest/eu/V1/sizeselector/sizeselector/1011C243-001',
    ),
  ).toBe(true);
  expect(robotsAllows(policy, '/eu/catalogsearch/result/')).toBe(false);
  expect(robotsAllows(policy, '/eu/sale?brand=asics')).toBe(false);
  expect(
    robotsAllows(
      'User-agent: Lacey\nDisallow: /\nUser-agent: *\nAllow: /',
      '/eu/shoe',
    ),
  ).toBe(false);
  expect(() => twentyOneLink(url + '?size=40')).toThrow();
  expect(() => twentyOneLink('https://evil.test/eu/shoe')).toThrow();
});
test('21RUN discovers only discounted actual catalogue products', () => {
  const p = { url, sku: '1011C243-001', price: 159.95, special_price: 119.95 };
  const html = `<div data-product="${JSON.stringify(p).replaceAll('"', '&quot;')}"></div>`;
  expect(
    twentyOnePage(html, 'https://21run.com/eu/sale/running-shoes').products,
  ).toEqual([{ url, sku: '1011C243-001' }]);
  expect(
    twentyOnePage(
      html.replace('119.95', '150.95'),
      'https://21run.com/eu/sale/running-shoes',
    ).products,
  ).toEqual([]);
});
test('21RUN maps EU thirds only using the labelled manufacturer table', () => {
  const f = structuredClone(fixture),
    v = f.sizes.products.find((p) => p.sku === f.parent.preselected_sku)!;
  v.sizes.find((s) => s.attribute_code === 'size_eu')!.label.content = '40 2/3';
  f.parent.sizes.find((s) => s.attribute_code === 'size_eu')!.label.content =
    '40 2/3 EU';
  f.sizes.size_table =
    '<table><tr><th>EU</th><th>US</th><th>UK</th><th>CM</th></tr><tr><td>40 2/3</td><td>8.5</td><td>7</td><td>25</td></tr></table>';
  expect(parse(f)[0]).toMatchObject({ size_system: 'UK', size: '7' });
  f.sizes.size_table = f.sizes.size_table.replace('<th>UK</th>', '<th>CM</th>');
  expect(() => parse(f)).toThrow('headers');
});
test('21RUN follows retailer pagination and does not accept repeated pages', () => {
  const base = 'https://21run.com/eu/sale/running-shoes',
    html = `<div data-product="{&quot;url&quot;:&quot;${url}&quot;,&quot;sku&quot;:&quot;sample&quot;,&quot;price&quot;:160,&quot;special_price&quot;:120}"></div><a class="pages-item-next pager-item" href="${base}?p=2">Next</a>`;
  expect(twentyOnePage(html, base).next).toBe(base + '?p=2');
  expect(() => twentyOnePage(html, base + '?p=2')).toThrow('advance');
});
