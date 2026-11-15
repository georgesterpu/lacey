# Shoehoo

**Nice shoes. Nicer prices.** A public, account-free running-shoe deal watcher for adults and kids. Working name; the existing deployment URL is retained.

The third pass replaces the green club theme with white, charcoal, cobalt and orange, removes Brave Runners branding, adds kids' fits, and introduces a deterministic checking/digest pipeline.

## Live behavior

- Real catalogue collection: Amphibian King, The Run Hub and Elverys, including Elverys boys'/girls' running footwear. Five other requested shops remain visibly planned.
- Explicit 🇮🇪 / 🇪🇺 seller labels, shop-specific links and exact variant URLs.
- Watches for a model, brand or category, fit/age group, size and budget. No ChatGPT sign-in. A private random HttpOnly device cookie scopes watch management.
- Unlabelled shop sizes are never silently converted to UK. “Watch this shoe” can use that shop's explicitly labelled listed-size scheme for the selected model/source.
- Source snapshots are validated before publication. Fresh product/page validation precedes sale digests; failures suppress alerts instead of trusting old data.
- Verified emails receive one combined HTML/plain-text digest per slot, up to two sale digests/day, with up to six shoes and direct retailer links. Actual delivery still needs a verified sender.
- `/email-preview` shows the HTML design using clearly labelled preview content. `/api/health` shows non-personal run/source/outbox status.

Read the [implemented reliability and scaling plan](docs/reliable-checks.md) for exact checks, guarantees, limitations, quotas, retry rules and upgrade triggers.

## Local development

Bun 1.4.4 and TypeScript 7.0.2 are pinned. The browser uses plain TypeScript/CSS. Local handlers run with Bun/native SQLite; Sites hosts the same Request/Response handlers in a Worker with D1.

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

The private GitHub repository `georgesterpu/shoehoo-jobs` contains this source, parser/build CI and the deterministic scheduler. `.github/workflows/shoehoo-checks.yml` targets 08:00 and 20:00 in `Europe/Dublin`, using ordinary code from `scripts/run-jobs.mjs`. A 15-minute catch-up trigger reuses the same slot if needed, without repeating a completed scan or digest. It has no language model or agent dependency. `CRON_SECRET` is a runtime/Actions secret; `APP_URL` is an Actions variable. The app remains public; the writer is authenticated.

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

Email credentials are not provisioned or fabricated. With no sender, watches save and the UI accurately reports email delivery unavailable. `ganuary.ie` has not been changed.

## Source map

- `src/sources.ts`: retailer contracts, strict normalization, kids/adult identity
- `src/scan.ts`: run leases/retries, atomic source snapshots, retention
- `src/validation.ts`: page/variant preflight and shared freshness cache
- `src/outbox.ts`: indexed matching, recipient digests, leases and idempotent retries
- `src/email-template.ts`: escaped, readable HTML and plain-text templates
- `src/schedule.ts`: Dublin calendar slots and daylight-saving handling
- `src/server.ts`: public app, guest watch privacy, confirmation and protected writers
- `tests/` and `fixtures/`: behavior tests and real retailer contract examples

Markdown percentages compare with retailer reference prices and exclude delivery. Coupons and below-market claims are not implemented. Product data/images belong to the linked retailers; review access rules and terms before expanding collection.
