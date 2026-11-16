# Keeping Lacey useful while shops and subscriptions grow

## Public browsing and private watches

`/api/catalogue` reads a compact, pre-grouped public projection in one indexed
query. Each source publishes its projection with its live snapshot pointer.
Product verification patches only that product atomically, including removals,
so concurrent checks cannot overwrite one another or leave known bad stock in
the public view. No member tables or size-level joins run for browsing. It
sets no device cookie and contains no watches, addresses or verification tokens.
Vercel may cache it for 60 seconds and serve the previous response while refreshing
for up to five minutes. The browser also removes offers beyond the 30-hour
freshness boundary. Check timestamps describe the observation, not the page visit.

The catalogue JSON is streamed in bounded chunks so adding shops cannot hit
Vercel's 4.5 MB buffered-response ceiling. It retains the same JSON contract and
shared CDN policy; large synthetic responses are checked for completeness and
UTF-8 correctness. A much larger catalogue should move to paged browsing before
approaching the CDN's streaming cache limit. See [Vercel response limits](https://vercel.com/kb/guide/how-to-bypass-vercel-body-size-limit-serverless-functions).

`/api/watchlist` is private, scoped to the HttpOnly device cookie and never shared
in the CDN. Shoes render before that request or legacy email repair finishes.
Internal background endpoints use a separate database connection, so a long
writer cannot occupy the browser driver's queue.

## Collection and publication

The scheduled GitHub worker uses Bun and a dedicated database connection pool.
It collects directly into Neon Postgres, avoiding Vercel's 240-second request budget.
Only the trusted scheduled/manual workflow gets the database secrets; pull request
checks do not. Delivery remains behind the authenticated production API and the
collector has no Resend key. Customer data is not rebuilt during deployments.

Shopify collection follows pagination to the end instead of stopping at 500
products. Repeated pages, contract errors, excessive duration and a 10,000-product
collection safety ceiling fail the source without replacing its published data.
A larger shop reaching a safety ceiling requires a persistent paged connector,
not a larger unbounded request. 21RUN already uses a persistent crawl cursor;
its collected rows stay unpublished until its crawl and validation finish.

Inventory summaries count distinct normalized shoe listings, all size variants,
listings with at least one available size, and listings entirely sold out. They
are committed with the same published snapshot pointer. They are not a claim
about stock outside the configured collections. Shop details distinguish the
last attempt from the last successful publication and display the actual current
sale-listing count separately.

For the small source refresh, only available variants discounted by at least 20%
are stored in the searchable snapshot. Full inventory counts remain in its
summary. This avoids writing thousands of full-price/sold-out size rows twice a
day. A valid zero-sale refresh replaces the old snapshot with an empty one;
ended sales and sold-out shoes do not linger. Unknown size systems remain
excluded from UK-specific alerts; no guessed conversions.

Each insert uses at most 500 rows on Postgres (50 / 950 parameters on SQLite),
with bounded collection transactions and protocol pipelines.
Private catalogue reads seek only published snapshot IDs and use 250-row keyset pages.
They do not scan staged catalogues. A failed snapshot never moves the live
pointer. Source status and freshness checks, product identity/price/stock checks
before sending, the recommendation ledger and unsubscribe suppression still
apply independently of caching.

## Honest coverage

A working website does not imply eight working retailers. MR, Running Warehouse
and Sports Direct remain disconnected where verification or customer links are
blocked. Life Style Sports is explicitly limited. 21RUN's advancing checkpoint
is not a completed catalogue. Never relabel these as complete to make a dashboard
look healthy. Inspect `sources`, `source_runs`, the cursor and live snapshot
counts together when auditing coverage.

## Release and operations

Use `bun run release`; see [release-guard.md](release-guard.md). It requires CI
on the exact commit, tests the staged production API and actual client assets in
mobile/desktop browsers, promotes that same build, and checks the public domain.
It rolls back if the public post-check fails. The browser fixture includes large
unpublished data, empty results, broken JavaScript, stalled requests and stalled
email repair. Tests also cover pagination, sold-out replacement, and keeping
public cache contents separate from private watch data.

The production browser workflow checks around the two daily source checks.
Inspect failures rather than suppressing notifications. Provider/network failures
remain possible; no test can promise permanent availability. No live test emails
or customer subscription mutations are needed for these read-only checks.

Fresh ingestion attempts use a new snapshot namespace instead of deleting a
partially written snapshot in the request path. Old staging data expires through
retention. Unused price-history writes were removed: displayed savings use the
retailer's stated reference price and cross-shop comparison, not a historical
market-price claim. Existing historical records retain their normal expiry.

Housekeeping runs independently at 03:00 Dublin time through `retention.yml`.
Each delete is limited to 100 records and commits independently. The worker has
a ten-minute budget, records whether another pass is needed, and resumes on its
next run. Expiry and exact variant lookups have dedicated indexes. A maintenance
failure cannot change a completed collection run to failed or block its digest.
Small collection writes also use 100-variant transactions and bounded retries
for transient database timeouts. Contract and identity failures are not retried.
Customer backups exclude the regenerable public read model; member, consent,
feedback, suppression and receipt data remain included. Migrations and their
checksums commit in one server-side transaction without interactive HTTP gaps.

Release verification also runs an authenticated operational write probe against
the exact staged build. It overwrites one fixed `ops:readiness` metadata key and
requires the database to return its fresh nonce within five seconds. It never
creates a subscription or sends email. The browser checks remain read-only.
