# 21RUN collection

The production connector is product-independent. It reads `https://21run.com/eu/sale/running-shoes`, follows the retailer's Next links, and discovers discounted products from the page's structured `data-product` JSON. There is no list of shoe names, product URLs, size limit or catalogue-size limit in production.

## Price and sizes

21RUN prices a parent colourway. Its size-picker action changes selected attributes and delivery; it does not request a different size price. The observed product-offer endpoint returns the parent SKU, its current regular/special EUR price, canonical URL, gender, colour, brand and shoe category. The size endpoint separately returns every variant SKU, its explicit size labels, actual stock and a manufacturer size table.

The collector joins these by parent SKU and cross-checks identity. It preserves all supported sizes, including out-of-stock records marked unavailable. It converts EU to UK only through that product's labelled table; there is no universal offset. Before an email, it GETs the customer product page and rechecks the API facts. This is entirely Bun HTTP; there is no browser, proxy or LLM in production.

A public deal currently means at least20% below the shop's regular/MSRP price. A watch defaults to25%. This is **not** a claim that the price beats the whole market or the retailer's30-day low. All amounts are integer cents. Different size systems are not guessed to be interchangeable.

## Background work

GitHub Actions schedules `scripts/run-jobs.ts` at08:00/20:00 Europe/Dublin with15-minute catch-up triggers. It calls the authenticated Vercel scan endpoint for the existing small feeds, then repeatedly calls `/api/internal/catalogue` for the full21RUN crawl. Retailer requests run inside Vercel and are paced at least one second apart.

The durable cursor lives in `app_state`; staged offers live in `offer_snapshots`. Each batch processes up to eight products, saves its rows and cursor atomically, and releases its short lease. Eight is a request-duration budget, **not** a limit on catalogue coverage. The next invocation resumes where it stopped. A completed crawl atomically replaces the public snapshot; the previous fresh snapshot remains available while collecting. No schema change or new queue service was needed. Old cursors expire after seven days.

A manual `catalogue_only` workflow input refreshes inventory without sending customer emails. The runner has a90-minute safety budget. Exhaustion leaves its checkpoint intact for the catch-up runner; failures are visible in shop status, not misrepresented as “no matches”. Real403/406/429 blocking stops collection and triggers the existing12-hour source cooldown. Permission or network problems cannot be fixed by increasing product limits.

## Cross-shop identity

Every observation retains its retailer, product/variant ID, size system, price, currency, timestamp and direct URL. At display and notification time, `shoe-identity.ts` groups conservative brand/model/department/width keys. Generation and qualifiers such as GTX, Max, Pro and Lite-Show remain part of identity. Colourways can share a model card; the size/shop filters are applied before choosing the cheapest offer. Alternative shops remain available in the card.

This is deterministic name normalisation, not a verified global product registry. GTINs/manufacturer IDs are not reliably supplied by every active feed. Ambiguous/unrecognised identities stay source-specific; no fuzzy or LLM matching is used. Do not claim perfect universal matching or compare unlabelled store sizes with UK sizes. Shared matching is useful but has documented limits.

## Images and samples

The21RUN image host is `images.21run.com`. It must be allowed in the site's `img-src` security policy. Images are retailer URLs; flag emoji remain native Unicode.

`fixtures/twentyone-product.json` is a reduced recording for parser regression tests. Production never imports it. `scripts/probe-eu-shops.ts` requires a caller-supplied product URL and is an optional read-only diagnostic; no default shoe is embedded there either.

## Research and limitations

Inspected the actual21RUN Magento/Hyvä storefront. Generic GraphQL returned403, so it is not used. The functioning same-origin endpoints are `/eu/rest/eu/V1/sizeselector/sizeselector/<parent>` and `/eu/rest/eu/V1/product-offer/product-alternative/<parent>/<variant>`. These are internal storefront interfaces, not a guaranteed external API contract.

Reviewed these existing implementations for ideas; none supplied a maintained21RUN-specific connector:

- https://github.com/jcubic/price.py — configuration, stored history, threshold notifications.
- https://gist.github.com/erikhansen/6ed95a7daee05c58ecfbb7abbd922dd0 — Magento crawl example; explicitly lists configurable products as unfinished, so it is not a replacement for size-aware checks.
- https://www.reddit.com/r/webscraping/comments/12aeg7d — discussion of variant data already present in structured page assets. Community discussion is a research lead; the actual retailer responses determine this implementation.

Current robots rules are fetched and checked before collection. They permit the clean paths we use and pagination `?p=`, while excluding filters/search/account/checkout routes. Robots instructions are not a licence. Referrals do not guarantee permission or prevent blocking. An approved feed remains the strongest long-term option.

Primary references: https://21run.com/robots.txt , https://21run.com/eu/terms-and-conditions , https://21run.com/eu/customer-service/delivery , https://www.hyva.io/blog/partnerships/catomize-x-hyva-data-consistency.html . Ireland is explicitly supported on the EU delivery page. Never reuse generic product delivery labels as an Irish arrival promise.
