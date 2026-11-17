# Lacey

**Happy feet. Cheeky prices. 😊** A public, account-free running-shoe deal watcher for adults and kids. Working name; the existing deployment URL is retained.

A friendly shoe lookout with a pair of smiling soles, readable labels, and a little blush in the emails. Men’s, women’s and kids’ are labelled **Department**, independently of shoe size or width. The app and scheduler use deterministic code, with no model calls.

## Live behavior

- Published catalogues: Amphibian King, The Run Hub, Elverys, 21RUN EU and MisterRunning. Life Style Sports has explicitly limited coverage. Sports Direct Ireland and Warehouse have implemented connectors but remain blocked by retailer HTTP 403/406 during full collection. See the [dated audit](docs/retailer-audit-2026-11-17.md) and live shop reports for actual publication times and counts.
- Explicit 🇮🇪 / 🇪🇺 seller labels, shop-specific links and exact variant URLs.
- Watches for a model, brand or category, fit/age group, size and budget. No ChatGPT sign-in. A private random HttpOnly device cookie scopes watch management.
- Unlabelled shop sizes are never silently converted to UK. “Watch this shoe” can use that shop's explicitly labelled listed-size scheme for the selected model/source.
- Ended discounts, vanished products and unavailable variants leave the public deals after a successful update. Failed sources and known dead links are hidden. Source snapshots are validated before publication. Fresh product/page validation precedes sale digests; failures suppress alerts instead of trusting old data.
- Recipient/model receipts prevent repeating a shoe across scans, watches and shops. Multiple watched sizes share one card; each size keeps its cheapest verified shop link. A large unsubscribe button and email-client one-click headers stop all sale alerts without signing in.
- Verified emails receive one combined HTML/plain-text digest per slot, up to two sale digests/day, with up to six shoes and direct retailer links. Actual delivery still needs a verified sender.
- `/email-preview` shows the HTML design using clearly labelled preview content. `/api/health` shows non-personal run/source/outbox status.

Read the [personality notes](docs/personality.md), [Vercel handoff](docs/deployment-handoff.md), and [implemented reliability and scaling plan](docs/reliable-checks.md) for exact checks, guarantees, limitations, quotas, retry rules and upgrade triggers.

## Local development

Bun 1.4.4 and TypeScript 7.0.2 are pinned. The browser uses plain TypeScript/CSS. Local handlers run with Bun/native SQLite. Vercel uses native Bun.SQL with separate Neon Postgres databases for production and preview. The old Turso database is retained for migration verification and rollback; it is never an automatic fallback after cutover.

```sh
bun install --frozen-lockfile
# Set a local CRON_SECRET in your untracked .env, then:
bun run dev
# In another terminal with the same secret and APP_URL:
bun run scan
bun test
bun run check
bun run build
```

The local server binds to 127.0.0.1 and stores `.data/brave.sqlite`. Ordered SQL migrations are applied transactionally from `drizzle/meta/_journal.json`; applied migrations are immutable. Source credentials, `.env`, database files and screenshots are ignored by Git.

Browser checks use an installed Chrome-family executable:

```sh
APP_URL=http://127.0.0.1:3000 BUN_CHROME_PATH=/path/to/chrome bun scripts/browser-check.ts
```

This creates, reloads, pauses and deletes a test watch; use development data. Unit/behavior tests do not call a real email service.

## Code-only scheduler

The private GitHub repository `georgesterpu/shoehoo-jobs` contains this source, parser/build CI and the deterministic scheduler. `.github/workflows/shoehoo-checks.yml` targets 08:00 and 20:00 in `Europe/Dublin`, using TypeScript executed directly by Bun from `scripts/run-jobs.ts`. Both workflows read the Bun version from `package.json`. A 15-minute catch-up trigger reuses the same slot if needed, without repeating a completed scan or digest. It has no language model or agent dependency. `CRON_SECRET` is a runtime/Actions secret; `APP_URL` is an Actions variable. The app remains public; the writer is authenticated. See the [stack and upgrade notes](docs/stack.md) for runtime boundaries, parser implementation and current package versions.

The job collects all shops once, retries failed sources within bounds, plans indexed matches in recipient pages, drains validated digests, and reads back health. The old ChatGPT automation must be turned off separately if still enabled; available Sites tools expose its state but cannot edit/disable it. Its former unauthenticated writer call is rejected by the new endpoint.

GitHub scheduling can be delayed, so the app displays actual timestamps rather than promising exact-on-the-minute delivery. See the reliability plan for the native-cron/queue upgrade and missed-run monitoring.

## Runtime configuration

| Key | Purpose |
| --- | --- |
| `APP_URL` | Public origin used for confirmation/unsubscribe links |
| `CRON_SECRET` | Strong shared secret for the code-only scheduler |
| `RESEND_API_KEY` | Server-only email provider credential |
| `EMAIL_FROM` | Verified sender address/domain |
| `DAILY_EMAIL_LIMIT` | Hard global delivery-attempt budget; default 100 |

Email credentials are not provisioned or fabricated. With no sender, watches save and the UI accurately reports email delivery unavailable. `january.ie` is connected to the isolated Vercel project; DNS and the dedicated sender must be verified before email is enabled.

## Source map

- `src/sources.ts`: retailer contracts, strict normalization, kids/adult identity
- `src/scan.ts`: run leases/retries, atomic source snapshots, retention
- `src/validation.ts`: page/variant preflight and shared freshness cache
- `src/outbox.ts`: indexed matching, recipient digests, leases and idempotent retries
- `src/shoe-identity.ts` and `src/recommendations.ts`: conservative cross-shop model identity and lasting per-recipient receipts
- `src/email-template.ts`: escaped, readable HTML and plain-text templates
- `src/schedule.ts`: Dublin calendar slots and daylight-saving handling
- `src/server.ts`: public app, guest watch privacy, confirmation and protected writers
- `tests/` and `fixtures/`: behavior tests and real retailer contract examples

Markdown percentages compare with retailer reference prices and exclude delivery. Coupons and below-market claims are not implemented. Product data/images belong to the linked retailers; review access rules and terms before expanding collection.

## Catalogue housekeeping

Independent housekeeping runs at 03:00 Dublin time in bounded pages; a cleanup failure cannot fail collection or delay a digest. The health response exposes `lastCleanup`. Old snapshots and link checks retain two days; histories, terminal notifications and unreferenced run records retain 90 days. Obsolete legacy product rows, expired confirmation tokens and old rate-limit counters are removed. Active watch preferences and sent-shoe receipts stay intact. See the reliability plan for the exact rules.

## Vercel production and recoverable data

See [the production runbook](docs/deployment-handoff.md) for the project, isolated production/preview Postgres databases, immutable checksummed migrations, encrypted backups, tested empty-database restoration, domain DNS records and email setup. Builds never reset the database. `bun run build:vercel` builds the Bun app; `bun run db:migrate` performs explicit, backed-up schema changes. Preview cannot send emails.

## Retailer connection audit (November 2026)

All eight connectors are implemented; implementation is separate from successful publication. Shopify feeds follow pagination to the end. The four paged retailers use persistent cursors, independent workers and atomic publication, with no product-name allowlists or first-24-product cap. Lifestyle checks all discovered sale products and all supported numeric size choices on the permitted entry pages. Further Lifestyle pagination is disallowed by its robots rules, so coverage remains explicitly limited. Unknown units remain shop-specific.

The [connector contracts](docs/retailer-connectors.md) describe actual price, stock, country, size and URL checks. The [17 November audit](docs/retailer-audit-2026-11-17.md) records completed catalogues, quarantines and the remaining Sports Direct/Warehouse cloud blocks. A successful sample fetch never counts as a full import. GitHub integration to Vercel is connected; main-branch auto-production deployment stays disabled so the guarded release command controls promotion.

See the [club-beta assessment](docs/beta-readiness.md) for launch scope, the follow-up country-session work, known limits and the evidence to require before expanding the audience.

Email ownership is stored independently of watches in `email_identities`. First signup sends verification automatically; one confirmation activates that browser’s pending watches and future watches for the address. Deleting a watch does not discard verification. The optional resend action uses short throttling and preserves an uncertain delivery’s token/idempotency key. Existing consented watches with no attempted verification are repaired automatically when their owner reopens the app. `bun scripts/browser-verification.ts` tests this flow against an in-memory database and fake mail provider.
