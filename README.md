# Brave Runners · Shoe Watch

**Running-shoe deals, in your size. No account needed.** Built with Bun 1.4.4 and TypeScript 7.0.2; hosted on Sites with a real D1 database.

## The second-pass journey

1. Browse deals. Fit, UK size and shop region are the three visible filters.
2. Buy at the clearly named shop, or select **Watch this shoe**.
3. Choose size and budget, then enter an email. No ChatGPT login or password.

A browser-specific watchlist supports pause, resume, removal and feedback. Watches do not automatically transfer to another device; clearing cookies starts a fresh list. That limit is stated beside the watchlist.

The redesign removes the large illustration, promotional panels, duplicate explanatory text and secondary navigation. Text and controls are larger: body/input text 17px, important mobile actions 17px, and supporting text usually 14–16px. Buttons have at least 44px targets, form controls have visible labels and focus states, and the mobile deal list uses a single readable column. Additional filters and source diagnostics are progressively disclosed.

Every deal prominently shows seller name, a flag, and a **Shop at [seller]** button. MisterRunning, Running Warehouse Europe and 21RUN use 🇪🇺 **EU shop**. Amphibian King, The Run Hub, Elverys, Life Style Sports and the Irish Sports Direct storefront use 🇮🇪 **Irish shop**. These labels describe the storefront region, not a guarantee about dispatch origin, shipping speed or arrival dates. Actual delivery dates remain the retailer's responsibility.

## Data and matching

- Real size-level collection: Amphibian King's running collections, The Run Hub's footwear collection, and a selected Elverys running-sale collection.
- Five additional retailers remain visibly **Coming later** until individual adapters are implemented.
- Each collection crawl is capped at 500 products. Truncation and source failures are shown under **Shops & last check**. An error never wipes a successful snapshot.
- Explicit UK size labels at Amphibian King are supported. Other shops' unlabelled numeric sizes remain unconfirmed and are excluded from exact UK-size matches. No EU/US conversion is guessed.
- Shoe, brand or category watches match exact fit, size system, size, budget and a minimum retailer markdown. The simplified UI uses 25% as the alert threshold; it is not another setup decision. Prices exclude delivery; any colour is the default.
- Offer cards use size-specific variant links when a size filter is selected.
- “Off” means below the shop's reference price, not a verified market-wide discount. Coupons, multi-buy offers and delivered-price comparisons are not yet counted.
- Products older than 30 hours are excluded. Changed-price history is kept for 90 days.

## Account-free privacy and email

`GET /api/dashboard` sets a random 256-bit `brave_device` cookie. It is HttpOnly, SameSite=Lax, host-only, and Secure on HTTPS. Only its SHA-256 digest is used as the database owner identifier. The app does not use ChatGPT identity headers. Each watch operation is scoped by the device identifier, and the public dashboard never returns emails, consent metadata, ownership identifiers or unsubscribe tokens.

Emails are user-entered and **unverified by default**. A confirmation message, when a sender is configured, provides a random 24-hour link whose hash is stored in `email_confirmations`. GET displays a confirmation page; POST explicitly verifies watches for that email on that device, preventing email scanners from subscribing somebody. New watches for an already-confirmed email on the same device inherit that confirmation. Another device does not inherit it.

`sendAlerts` selects only active, verified watches. Confirmation delivery is capped at one email per address per day, across devices. Form writes are limited per IP and per device, have origin/content-type checks, and watches require consent. A person who did not request a confirmation can ignore it and receives no sale emails.

Actual email delivery still requires server-only `RESEND_API_KEY`, verified `EMAIL_FROM` and `APP_URL`. Without them, watches work and the interface clearly says email delivery is not ready. No sends are simulated. Sale emails are capped at one per watch per day, suppress duplicate prices, use provider idempotency, and support confirmed unsubscribe/removal with cascading alert-history deletion.

## Run and verify

```sh
bun install
bun run dev
# In another terminal:
bun run scan
```

Open http://127.0.0.1:3000. Local storage is `.data/brave.sqlite`; the Bun server uses the same guest-cookie behavior as production. SQL migrations are applied transactionally in journal order. Secrets and runtime data are ignored by Git.

```sh
bun test
bun run check
bun run build
BUN_CHROME_PATH=/absolute/path/to/chrome bun scripts/browser-check.ts
```

Browser verification creates, reloads, pauses and removes a test watch. Use it against development data. It checks desktop/mobile overflow, the no-account form flow and readable mobile controls, and saves ignored screenshots.

## Hosting and the existing schedule

The browser uses plain TypeScript and CSS, without a UI framework or browser dependencies. Standard Request/Response handlers run in Bun with native SQLite locally, and in a Cloudflare Worker with D1 on Sites. Bun is the development/build runtime; the hosted Worker is not running Bun.

The tracked `.openai/hosting.json` retains the existing Site ID and `DB` binding. Sites applies the append-only `drizzle/` migrations before publishing. Build output is `dist/server/index.js` with its HTML, CSS and client script bundled. The public Site audience is managed through Sites; browsing and writing guest watches do not require ChatGPT sign-in.

The linked 08:00/20:00 Europe/Dublin automation remains the scheduler. Its existing `POST /api/internal/scan` writer still works after public access is enabled. This endpoint accepts no URLs, recipients, messages or user instructions; it only refreshes the allowlisted public catalogue and invokes the consent/verification-gated alert logic. An atomic database claim allows at most one request in each 00:00–12:00 and 12:00–24:00 UTC window, plus the existing overlap lease. Repeated requests return `skipped`, so visitors cannot turn the endpoint into an unrestricted crawler or email sender. A visitor could request a due update before the scheduled task; that task will then skip the same already-requested window.

A failed scan consumes its time window; individual source errors are recorded and another attempt occurs in the next window. To verify the updater, POST once and GET `/api/dashboard` to read persisted timestamps/source status. Never claim a scheduled run occurred just because the schedule was saved. The old private-only `SITE_ACCESS` and `SCAN_SECRET` settings are no longer used; no admin or runtime configuration API is exposed.

The app makes no LLM calls. The scheduling service has its own account entitlements. No Vercel account, paid subscription, domain change or email credential is created by this app. `ganuary.ie` has not been connected.

## Tables

| Table | Purpose |
| --- | --- |
| `sources` | Source health, coverage and observation time |
| `offers` | Stable retailer variant, size, stock, fit, colour and integer-cent prices |
| `price_history` | Observed price changes |
| `watches` | Private device ownership, contact, consent, criteria and confirmation state |
| `email_confirmations` | Hashed, expiring email confirmation capabilities |
| `notifications` | Delivery attempts, idempotent identity and send status |
| `feedback` | Private suggestions and issues |
| `app_state` | Scan lease, bounded update windows, rate limits and last scan |

## Next useful work

Configure a verified sender; confirm the other shops' sizing conventions; add one requested retailer adapter at a time. Learn from 5–10 club members whether alerts lead to useful purchases. Only add market-price claims after comparing the same model generation, fit, width and size across shops, with verified delivery costs and promotion eligibility.

## References

- [Bun 1.4](https://bun.com/blog/bun-v1.4) and [TypeScript 7.0](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
- [Bun WebView](https://bun.com/docs/runtime/webview)
- [Resend email API](https://resend.com/docs/api-reference/emails/send-email) and [idempotency](https://resend.com/docs/dashboard/emails/idempotency-keys)

Product data and images come from the linked retailers. Review source access rules and terms again before expanding collection.
