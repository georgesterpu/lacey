# Retailer imports

The app and scheduler are TypeScript on Bun. No language model or production
browser is involved. New product names and URLs are discovered from retailer
pages; recorded examples under `fixtures/` are regression data only.

## Paged sources

`catalogue-job.ts` owns leases, retries, staged variants, full inventory totals
and atomic publication for 21RUN, Running Warehouse Europe, MisterRunning and
Sports Direct. Each retailer has a separate cursor and GitHub matrix job. One
blocked shop does not cancel the other jobs. A batch is a checkpoint budget,
not a product/name/catalogue limit. Only a finished catalogue moves its live
pointer; interrupted results remain unpublished.

- **21RUN:** EU sale catalogue, actual size-selector/product-offer responses and
  manufacturer-labelled unit mappings. A disabled final-page Next anchor ends
  pagination; an active backwards link remains an error.
- **Warehouse:** every discovered product in the men's and women's sale pages,
  using the catalogue's actual URLs. Each product uses the shop's country
  preference form (`POST vat=IE`), with a clean customer link;
  the parser requires selected Ireland, VAT-inclusive EUR and labelled UK size
  rows. Numeric stock including `3+` is available; lead times such as `15 Days`
  are excluded. No manufactured descpage URLs or fixed first-24-product cap.
- **MisterRunning:** all pages of the men's and women's running-shoe catalogues.
  Product ID, manufacturer SKU, URL, EUR price, first-listed reference price,
  labelled UK sizes and available buttons are checked. The explicit model span
  supplies the title, independently of colour and department descriptors.
- **Sports Direct Ireland:** the Irish running-sale pagination and embedded
  product data. Public JSON-LD verifies the product/colour identity; the server's
  React Flight JSON supplies exact variant SKU, stock, current price and ticket
  price. Single-colour Product and multi-colour ProductGroup markup are supported.
  Oversold quantities are unavailable. Member-only prices are ignored.

Sports Direct's public pages stalled Bun's HTTP clients during this audit. Its
connector therefore invokes the normal system **curl** HTTP client through
`Bun.spawn`; this is an explicit runtime dependency, not another app runtime.
There are no cookies, browser impersonation, rotating proxies, private API calls
or CAPTCHA solving. The blocked `/api` routes are not used. The collection
worker requires curl; Warehouse also uses that standard client after the native
client received HTTP 406 on the runner. These are checks on the collection
worker, not a promise that a retailer accepts all cloud networks. Other sources
continue to use Bun fetch. The collection worker also performs
pre-email stock checks. The production email server requires the existing
15-minute verification cache; a missing check requeues delivery instead of
fetching from Vercel, sending an unchecked offer, or losing the job. Current
watch state, frozen retry payloads, durable receipts and unsubscribe status are
still rechecked immediately before provider delivery.
The production collection endpoints refuse remote retailer work: the scheduled
worker writes results directly. This prevents a Vercel-only access failure from
pausing a collector that runs elsewhere.

The Sports Direct size strings observed here are shop labels such as `4 (37.5)`;
their unit is not explicitly attached to the variant data. They remain
shop-specific until an authoritative mapping is verified. They must not silently
match a UK-only watch. “Watch this shoe” supports a model/source-specific watch.

## Safety and freshness

The shared HTTP helper reads robots rules and paces each shop. HTTP blocking
responses stop collection with a cooldown. Network/server failures retry from
the unchanged checkpoint within bounds. Invalid individual products are recorded
and withheld; more than 5% invalid records prevents publication. Repeated pages,
wrong countries, currencies, SKUs, unexpected catalogue shrinkage and missing
contracts fail closed. Public stock is checked again before sending email.
Repeated checks during an active cooldown do not make HTTP requests or advance
its last-attempt timestamp. The worker reports a paused import explicitly.

Shopify Unicode handles, such as the actual trademark-marked Run Hub handles,
are validated and encoded as one path segment. The same rule protects product
verification. Trademark symbols are removed before model-key normalization so
they cannot accidentally introduce the letters `TM` into a model identity.

The small Shopify feeds and the explicitly limited Lifestyle connector retain
their own source refresh. Full normalized inventory totals are separate from
available offers discounted at least 20%. Unavailable or full-price size rows do
not accumulate in new sale snapshots. Retention remains independent of ingestion.

## Operations

The daily 08:00/20:00 Dublin scheduler runs the small refresh and delivery job,
then independent catalogue jobs. A `catalogue_only=true` manual dispatch reruns
all four paged workers without email. Their 90-minute budgets preserve cursors;
monitor Actions usage rather than assuming unlimited free runner time.

For a parser fix, retain the existing cursor. If its source run is in a permanent
failed state, first take a production backup, inspect the exact saved error and
checkpoint, then reset only that source-run status to pending before resuming.
Do not reset customer records, fake a new checked-at date, or broadly clear
failed runs. Only successfully fetched variants receive a new observation time.

Verify a release with the exact GitHub revision, native Postgres integration,
staged write/transport check and mobile/desktop browser checks. Then inspect
actual source snapshots, inventory arithmetic, last attempt versus last success,
and direct customer links. Counts should come from a completed import, not from
how many products a retailer advertises or how many staged rows exist.
