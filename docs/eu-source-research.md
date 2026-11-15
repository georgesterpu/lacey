# EU shop investigation — 15 November 2026

These are research results, not production-ready connectors. Neither shop was enabled and no customer records or emails were touched.

## Reproduction

Run `BUN_CHROME_PATH=/path/to/chrome bun scripts/probe-eu-shops.ts` using Bun 1.4.4. This performs read-only requests for one real product per shop and prints public product facts. It does not use proxies, stealth plugins, CAPTCHA solving, private keys or an LLM. A normal Chromium session loaded both product pages. Python urllib requests returned403, but a subsequent Bun native-fetch probe returned200 for both product pages and both21RUN JSON endpoints. This is a client-dependent result; the exact cause was not established. Local success does not establish success from GitHub Actions or Vercel.

## 21RUN: strongest structured-data candidate

Confirmed Magento/Hyvä from its own served assets (`Hyva_Theme`, Alpine, Smile ElasticSuite). Hyvä's own case study also identifies the retailer: https://www.hyva.io/blog/partnerships/catomize-x-hyva-data-consistency.html . Do not assume it runs Shopware.

Observed its real size picker calling these same-origin GET endpoints, both returning JSON with HTTP 200 in a normal browser:

- `/eu/rest/eu/V1/sizeselector/sizeselector/1011C243-001`
- `/eu/rest/eu/V1/catalog/delivery/1011C243-001`

The first contains variant SKU, parent SKU, brand, gender, colour, `is_available`, `stock.qty`, `stock.is_in_stock`, `stock.backorder_mode`, explicitly labelled EU/US sizes, alternative colours and a UK conversion table. Example: black EU39 is unavailable; EU40 is directly available. Alternative-colour availability must never make the requested black variant eligible. `total_products` and `total_available_products` were both zero despite a populated 17-element products array, so those summary counters cannot be trusted.

Product URL: https://21run.com/eu/asics-novablast-6-men-1011c243-001 . The page displayed MSRP159.95, an **as low as** price119.95, and a separate past-30-day low123.95. These are distinct concepts. The size endpoint did not supply variant prices in the sampled objects; the next investigation must trace the selected-variant price source before attaching119.95 to all sizes. EU storefront alone does not prove final Irish tax/shipping context.

Python urllib requests to both endpoints returned403; Bun native-fetch requests to both returned200 with valid JSON, without a browser or cookie setup. Prioritise a Bun HTTP collector and verify it repeatedly from the scheduled GitHub runner before adding browser overhead. Browser collection remains a fallback requiring its own reliability checks. These are internal storefront APIs, not a documented external integration contract. Generic Magento GraphQL supports variants, but a working GraphQL interface on this shop was **not** established: https://developer.adobe.com/commerce/webapi/graphql/schema/products/interfaces/types/configurable . Prefer the observed storefront calls over guessing endpoints.

## MisterRunning: unusually useful size and identity markup

Normal browser product URL: https://www.misterrunning.com/en/asics-novablast-6-mens-running-shoes-foggy-teal-1011c243-401.html . Size buttons expose `data-uk`, `data-eu`, `data-usa`, `data-cm`, `data-ean` and stock text/classes. For example, US7.5 / UK6.5 / EU40.5 had EAN4571633746185 and an available label. Manufacturer model1011C243-401 and retailer referenceXRF63056 are visible. This is a much safer starting point for exact matching than shoe-name similarity alone. Stock rules still need tests against sold-out and disabled variants, with selected-size price verification.

The page loads Clerk.io recommendations/search, confirmed by scripts and its own privacy page: https://www.misterrunning.com/en/privacy/ . Clerk's documented search API supports product attributes: https://docs.clerk.io/reference/search-search . This may help discovery, but its search index is not established as authoritative for size-level stock. No private API or approved merchant feed was obtained. A public search key is not permission to use private product-management endpoints.

Important parsing trap: the rendered page's Trustpilot JSON-LD described model1011C243-400 and an Italian product URL, while the actual viewed product was1011C243-401. Reject mismatched review/related-product metadata; validate visible model, canonical URL and size EAN together. Do not take the first Product JSON-LD object as truth.

The default browser context explicitly showed Italy shipping. Ireland VAT, destination, shipping and coupons remain unverified. The parent company's Odoo integration is described by its technology provider, but that does not establish the storefront platform or a public Odoo API: https://www.smau.it/milano/success-stories/mister-tennis-integra-i-processi-in-un-unico-sistema-digitale-per-un-e-commerce-pi-efficiente .

## Existing approaches and feeds

Public searches did not find a credible maintained scraper specifically for either retailer. An affiliate directory mentions an old21RUN feed, but references the retired Affilinet network; do not claim current Awin access from that. Awin documents product-feed delivery generally (https://www.awin.com/us/publishers/tools), but neither merchant's current membership, acceptance or variant-level feed has been confirmed. An approved variant feed would be preferable if available.

## Release gates

Prioritise a small21RUN Bun HTTP/API prototype, then MisterRunning's explicit-size markup. Run collection once per shop per08:00/20:00 Dublin slot, shared across all watches, with a bounded browser session, cached product checks and the existing deterministic matching/outbox pipeline. No browser or LLM per subscriber.

Before enabling either: confirm Irish destination prices, actual selected-size prices, in-stock and sold-out samples, colour and generation identity, kids/adult separation, canonical customer navigation, and repeated successful runs in the real scheduler environment. Preserve source-specific failures, never turn403 or incomplete parsing into “zero matches”, and suppress uncertain offers. Native flag emoji remain untouched.

## Implemented Bun connector

`src/twentyone.ts` now uses native Bun fetch only. Discovery reads retailer catalogue `data-product` JSON for discounts of at least20%, up to two products each for men/women/kids. Each product is fetched at its canonical clean URL, followed by its size API and up to four available variants at the observed `product-offer/product-alternative/<parent>/<selected>` endpoint. That response explicitly identifies the preselected SKU, size, canonical URL, currency and price. It is cross-checked against the stock response and product metadata; the headline minimum is not used. Official per-product size charts map EU thirds to UK sizes. All links go to the canonical product page; size is shown in Lacey and selected by the customer at the shop.

A local real-data run verified six products and24 size offers, including kids. Coverage is deliberately partial, not a claim of the entire catalogue. Presend validation shares the existing15-minute per-product cache across subscribers. Source-level403/406/429 or401 triggers a12-hour cooldown and removes the source from publication; persistent source state suppresses immediate scheduled retries. Each process serialises requests at least one second apart. No retries, proxies, cookies, browsers or LLMs are needed for collection.

Fetched https://21run.com/robots.txt with Bun on15November2026. It disallows filter-query URLs, search, checkout and several account/interactive paths. The clean product URLs and observed REST paths were not disallowed. The connector checks the current file before each collection/verification and applies matching rules before each subsequent request. These crawl instructions are not a licence or a merchant agreement. Reviewed the public EU terms (https://21run.com/eu/terms-and-conditions): no explicit scraper clause was located, but that does not establish permission. An approved feed or written merchant agreement remains the best long-term arrangement.

Ireland is explicitly listed on https://21run.com/eu/customer-service/delivery . At investigation it says7working days, shipping6.50EUR below80EUR and free above80EUR. Do not reuse the product API's generic2–5day label as an Irish delivery promise. Listed prices include VAT according to article11 of the EU terms; final destination totals remain the shop's checkout responsibility.

Scheduling is unchanged: GitHub Actions calls the authenticated Vercel scan endpoint at08:00/20:00Europe/Dublin, with15-minute catch-up triggers. Bun collection actually executes inside Vercel, so retailer requests originate from Vercel egress, not the Actions runner or a subscriber's device. Schedule events can be delayed. A block affects our collector; it does not mean customers' own browser IPs are blocked. Referrals do not prevent or confer immunity from blocking.
