# Brave Runners · Shoe Watch

**Good running shoes, in your size, at a price worth noticing.** A small club experiment built with Bun 1.4.4 and TypeScript 7.0.2.

## The useful first product

A runner watches a model/family (“Brooks Ghost”), a brand, or a category (everyday, support, speed, trail). They choose UK size, fit, maximum item price, and a minimum retailer markdown. Any colour is the default. Specific model watches match whole tokens, so Kayano 31 does not accidentally match Kayano 32.

The dashboard shows real, recently checked stock. It also lets runners discover a category outside their usual brand, save another watch, pause/remove watches, and submit ideas or trusted shops. The first success measure is **a runner buying a useful pair they would otherwise have missed**, rather than the number of products crawled.

No master catalogue of every shoe is required. Preserve retailer product/variant IDs, use source taxonomy for broad categories, and accept free text for model families. Retailer descriptions can be wrong; support categories describe the shop's classification, not medical advice.

## What works, and the current boundary

- Database-backed personal watches, private to the signed-in user. Email comes from authenticated identity; a visitor cannot subscribe somebody else's address.
- Size-level, in-stock price collection from Amphibian King's running collections, The Run Hub's footwear collection, and an Elverys running-sale collection. These are real HTTP reads, not sample data.
- Eight initial sources are registered. 21RUN, MisterRunning, Running Warehouse Europe, Life Style Sports, and Sports Direct remain explicitly **planned**, pending individual adapters and access review.
- Source success/error timestamps, bounded crawl coverage, stale-data exclusion, and changed-price history. The Run Hub and Elverys can exceed the 500-product collection cap; this is shown as limited coverage, not complete catalogue coverage.
- Amphibian King labels UK sizes explicitly. Unlabelled numeric sizes at other shops are stored with an unknown sizing system and **excluded from exact UK-size alerts** until the retailer's convention is verified. No universal EU/US conversion is guessed.
- Matching and a server-only Resend HTTP transport, with a one-watch-per-day email cap, duplicate suppression, bounded retries, and a confirmation page to unsubscribe. Actual delivery needs `RESEND_API_KEY`, a verified `EMAIL_FROM`, and `APP_URL`. Without them, no sends are simulated and the UI says email is not connected.
- A protected scan endpoint for unattended updates. Creating a job and a successful scheduled run are separate facts; refer to the live Site's linked automation for its actual schedule state.

For MVP, savings are measured against **the retailer's own reference price**. This is not “below market,” an independently verified RRP, or a checkout-total comparison. Delivery costs are explicitly additional. Coupons and multi-buy campaigns are not applied automatically. This avoids turning an expired code, inflated reference price, or mismatched size into an alert.

## Run locally

```sh
bun install
bun run dev
# In another terminal, ingest current retailer data:
bun run scan
```

Open http://127.0.0.1:3000. Local development uses `.data/brave.sqlite` and an explicit developer identity (`LOCAL_USER_EMAIL`, default `runner@example.test`). The server binds to loopback; **do not expose the local developer server to the internet**. No production user data or tokens belong in Git.

```sh
bun test
bun run check
bun run build
```

Browser verification uses Bun's native WebView and an installed Chrome-family browser:

```sh
BUN_CHROME_PATH=/absolute/path/to/chrome bun scripts/browser-check.ts
```

That script creates, reloads, pauses, and removes one local watch; run it against development data, not a production account. Screenshots are ignored by Git.

## Architecture

The browser is plain TypeScript + CSS: no frontend framework, client UI dependencies, CDN JavaScript, trackers, or model calls. `src/server.ts` uses standard Request/Response APIs. `src/local.ts` runs it with Bun and native SQLite; `src/worker.ts` runs the same handlers in a Cloudflare Worker. **Bun is the development/build runtime and local backend; the hosted Sites backend runs in Workers, not Bun.** A Bun production server with a persistent disk can use the local adapter after replacing developer identity with trusted authentication.

Sites provisions the real cloud D1 binding `DB`, applies versioned SQL migrations in `drizzle/`, and protects the private preview with ChatGPT sign-in. The app uses a tiny D1-shaped SQL interface rather than an ORM. SQLite stays portable and the database can later move to Supabase/Postgres if the product earns that complexity.

Tables:

| Table | Purpose |
| --- | --- |
| `sources` | Adapter, last attempt/success, coverage, errors |
| `offers` | Source variant, stock, fit, original size system, colour, integer euro cents, retailer reference, observation time |
| `price_history` | Price changes, retained for 90 days |
| `watches` | Owner, authenticated email, matching criteria, explicit consent, pause state, random unsubscribe token |
| `notifications` | Idempotent alert identity, attempts, delivery state; cascades on watch deletion |
| `feedback` | Private club ideas, source suggestions, issues |
| `app_state` | Scan lease and last completed scan |

Ingestion upserts stable variant IDs, retains previous snapshots on source errors, and only retires vanished variants after an entire collection crawl succeeds without truncation. Offers older than 30 hours are not shown or emailed. A database lease prevents overlapping scans. No arbitrary user-supplied URL is fetched: new sources require an allowlisted adapter in source control.

Alerts require current availability, exact size system and size, compatible fit, budget, markdown threshold, model/brand/category criteria, and optional colour. Prices use integer cents. Email provider success is required before marking an alert sent. Retry keys expire after 23 hours, inside the provider's 24-hour idempotency window; retries are capped at three. Paused/deleted watches are excluded on the next scan.

## Deployment and unattended checks

The current deployment uses Sites and `.openai/hosting.json`; Sites owns the D1 binding and authentication. `bun run build` emits one bundled Worker at `dist/server/index.js`, with its client and CSS embedded, plus deployment metadata. Deploy through the Sites source workflow, which includes `drizzle/` migrations in the archive.

`POST /api/internal/scan` updates the database without rebuilding or republishing. On an **owner-private Site** with `SITE_ACCESS=private`, the platform's authenticated Site/service-access boundary protects it. An unattended caller obtains current Site service access through Sites `get_site` and sends it as `OAI-Sites-Authorization: Bearer …`. Do not store that credential in source, job prompts or browser code. Read back `/api/dashboard` after a scan to verify timestamps and source status; one successful source must not conceal another source's failure.

**Before making the Site public:** set `SITE_ACCESS=public` and a strong `SCAN_SECRET`, redeploy, and require `Authorization: Bearer <SCAN_SECRET>` for the writer. Never leave the private-site assumption enabled on public hosting. Public visitors still need a supported authenticated identity to create watches. The loopback developer identity must never be used in a public deployment.

`ganuary.ie` has not been connected or changed. A public club launch still needs the hosting/audience choice, sender-domain verification, and domain routing. If moving to Vercel, use a managed database and trusted identity adapter: ephemeral Vercel disks cannot hold the local SQLite file. A twice-daily job also needs a hosting plan/scheduler that allows it. The built app does not assume any particular Vercel plan entitlement.

The Vercel CLI available during this build required account login even for Marketplace discovery. No Vercel resource, email account, paid subscription, domain change, or provider credential was invented or provisioned as a substitute. Email configuration remains a real launch dependency.

## Costs and next decisions

The app makes zero LLM calls. Scheduled source adapters and deterministic matching are cheaper and easier to audit than an agent guessing live prices. Use an LLM later for bounded catalogue review or feedback summaries if it proves useful. D1/Worker and transactional-email free allowances may suit a club pilot; verify current provider terms before promising a zero-cost public service. Sites publication/scheduling follows the account's own entitlements.

Ask the first 5–10 runners for one watch and a week's feedback. Learn whether exact replacements or broader discovery gets useful matches, whether the budget is realistic, and whether an email led to a purchase. The existing feedback box captures the qualitative side without adding analytics or tracking links.

Priorities after that: confirm remaining retailer size conventions; complete one requested source adapter at a time; verify Ireland delivery costs and promotion eligibility; then compare the **same generation/fit/size/width** across shops. Only call an offer below market once comparable current observations support it. Add a small owner feedback/source-management view after learning how often manual changes are needed.

## Research references

- [Bun 1.4 and its Rust rewrite](https://bun.com/blog/bun-v1.4)
- [TypeScript 7.0 announcement](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- [Bun WebView browser automation](https://bun.com/docs/runtime/webview)
- [Resend send-email API](https://resend.com/docs/api-reference/emails/send-email) and [idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)
- [MisterRunning's Ireland shipping table](https://www.misterrunning.com/en/shipping/) and [21RUN delivery](https://21run.com/eu/customer-service/delivery)
- Data and images originate from the linked retailers. Robots/access rules and terms should be reviewed again for each adapter before broader or higher-frequency collection; robots availability alone is not permission or a reliability guarantee.
