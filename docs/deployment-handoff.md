# Lacey production: Vercel and january.ie

Vercel project **lacey**, ID `prj_dMJPR26hdpOfYyHecvwO6aMNeiNi`, under **george-sterpus-projects**. It is independent of `blockops`; no BlockOps settings, credentials or storage are reused. The sender is **Lacey <lacey@january.ie>**. The canonical website is **https://lacey.january.ie**. The main january.ie website stays independent. The temporary production alias is **https://lacey-january.vercel.app**.

## Persistent data

Production uses **Neon managed Postgres**, provisioned through Vercel Marketplace on the Free plan in London (`lhr1`). Production and preview/development use independent database projects (`lacey-postgres-production` and `lacey-postgres-preview`). `LACEY_PG_DATABASE_URL` is server-only and scoped to the respective environment. The old Turso databases remain available for verified migration recovery; configuring Postgres never silently falls back to Turso after a connection failure.

`src/database.ts` and `src/postgres.ts` adapt prepared, bound SQL to native `Bun.SQL`, including atomic batches and consistent read-only backups. No Node server or Postgres driver package is required. Local SQLite and legacy export support remain available. `server.ts` is the native Bun entrypoint. Builds, previews and promotions never recreate, seed, wipe or restore production data.

The authorized provider migration uses `scripts/migrate-postgres.ts`: an encrypted full export, an empty independently provisioned target, schema-checksum validation, and SHA-256 comparisons of every field in every table. Inactive source-side triggers can freeze customer writes atomically during the final copy/cutover. They are absent from Postgres. Do not unlock the old source after successful cutover or run pre-Postgres code rollbacks after customer writes resume: that would create two diverging watchlists. Before releasing, require the Postgres integration CI, operational write probe and staged/public browser checks.

## Migrations and releases

1. Review and test the code, including both runtime builds. Reuse an existing migration file unchanged; add a new numbered SQL migration for a schema extension.
2. Pull the intended environment explicitly. Verify `vercel project inspect --non-interactive` identifies this project and scope.
3. Run `bun --env-file=.env.production.local --env-file=.env.operations.local run db:migrate`. When a database exists, this first saves an encrypted member-data backup locally. Migration history stores a checksum for each applied file and rejects altered or unknown history. Schema changes and history updates commit in one write transaction.
4. Prefer additive changes compatible with the current and previous app. Stage a production build with `vercel deploy --prod --skip-domain`, verify it, then promote that exact deployment. Destructive schema changes require a separate reviewed data migration and retention plan; no schema reset/push command exists here.
5. Verify health, actual source timestamps, backup status, consent, unsubscribe and a saved watch. A code rollback does not roll back database contents.

Git pushes on main run CI but do not automatically replace production (`git.deploymentEnabled.main=false`). Branch previews use their own database. Production promotion remains an explicit release step after migration and verification.

Useful commands:

```sh
vercel env pull .env.production.local --environment production --yes
vercel env pull .env.preview.local --environment preview --yes
bun --env-file=.env.preview.local run db:migrate
bun --env-file=.env.production.local --env-file=.env.operations.local run db:backup
bun run check
bun test
bun run build:vercel
```

Production/preview Secrets are not exported by Vercel env pull. The privately stored `.env.operations.local` contains Lacey’s scheduler and backup encryption keys for authorized local operations. Keep an additional secure copy of the encryption key in your password manager; an encrypted archive cannot be recovered without it. All `.env.*`, `.data`, local credentials and snapshots are ignored by Git, and private local files use owner-only permissions.

## Backups and restoration

Turso provides provider-managed point-in-time recovery, subject to the selected plan’s retention. This is supplemented by an independent **encrypted member-data backup after every scheduled run**, retained as an encrypted artifact in the private GitHub job repository for 14 days. The protected `/api/internal/backup` endpoint reads the selected tables in a single read transaction, compresses the result, and encrypts it with AES-256-GCM and a random nonce. The GitHub runner receives ciphertext only; the decryption key stays in Vercel and the private operations copy. `/api/health` exposes `lastBackup`, without member data.

The snapshot includes watches, emails, consent, verification/unsubscribe tokens, feedback, suppression status, sent-shoe receipts, job/run records, delivery counters, source configuration, application state and schema checksums. Recollectable catalogues, link-check payloads and price history are excluded. Durable recommendation receipts are included so recovery cannot restart old shoe alerts.

Restore only into a **new, empty, independently provisioned database** with the matching schema:

```sh
# Explicitly load that new database’s credentials, never the live destination.
bun scripts/database.ts restore /private/path/lacey-backup.enc --empty-database
```

The restore checks authenticated encryption and schema compatibility, rejects a nonempty destination, and imports the records atomically. Queued/sending emails are suppressed and ambiguous reservations remain suppressed after restoration. Source catalogues must be recollected before returning to service. Tests exercise restoration of consent, tokens, feedback and recommendation receipts, and verify an unsubscribe still works after recovery. This protects against common failures; no storage service or backup setup guarantees zero data loss under every disaster.

## Initial migration from Sites

The previous deployment retains its managed Cloudflare D1 database for recovery. Its public handler becomes a redirect to lacey.january.ie at cutover, so it cannot accumulate a separate watchlist. A private, complete export of the member-data tables was taken before import. It contained **zero watches/subscribers and one feedback entry**. `scripts/import-sites-data.ts` imported the feedback and checked every member-table row count in a transaction. It refuses truncated exports, populated destinations and unsupported historical-job references. The old catalogue is recollected from the approved sources rather than copied as stale offers. No member data was invented or discarded.

Keep the old D1 binding and encrypted migration backup until the transition is verified.

## Email setup and privacy

The production sender is `Lacey <lacey@january.ie>`, with a dedicated Resend Sending-access key restricted to january.ie. The account’s existing Resend plan and sending reputation are shared at the provider level; this does not reuse BlockOps’ API key. Preview/development can never send, even if email credentials are mistakenly copied there. `EMAIL_ENABLED` is an explicit production kill switch. It is now true after the custom domain and sender were verified. The app’s attempt budget is 50 per day initially, leaving headroom in the shared free email account.

The user is configuring Resend in its dashboard and will add its exact DKIM/return-path records at the authoritative DNS host. Sending from a verified address does not create a receiving mailbox at the domain host. Incoming-mail MX records are separate and are not replaced by this deployment.

Emails are kept behind server-side credentials. The public API does not expose addresses; private watch management uses a random HttpOnly, Secure, SameSite cookie. Consent and email confirmation precede alerts. Token links provide unsubscribe without sign-in. Provider transport, member-data retention and access should be reviewed before a wider launch; bounce/complaint webhooks remain a documented next step.

## Scheduler and isolation

The existing private GitHub repository `georgesterpu/shoehoo-jobs` remains the source/CI/scheduler repository. The deterministic runner targets 08:00 and 20:00 Europe/Dublin, with catch-up triggers and a fresh Lacey-only `CRON_SECRET`. After the Vercel cutover, its `APP_URL` points to the Vercel production alias until the custom domain resolves, then to lacey.january.ie. It has no LLM dependency. The earlier ChatGPT task still requires separate account cleanup if enabled; it is not used by this runner.

BlockOps’ environment variables, storage and project configuration are unchanged. Vercel/Turso account limits and the Resend account quota are shared account-level limits even though project data and app keys are isolated.

## Website DNS

The authoritative nameservers remain with the existing host. Vercel returned these records for this project:

| Type | Name | Value |
| --- | --- | --- |
| CNAME | lacey | 437124a36273bfa8.vercel-dns-017.com |

The project owns the lacey.january.ie association; the apex and www are not assigned to Lacey. The DNS panel can use the full name lacey.january.ie rather than the relative label lacey. Ownership verification and DNS/HTTPS readiness are distinct; check both before declaring the custom domain live. Do not replace unrelated TXT/MX records or change nameservers.

References: [Vercel Bun runtime](https://vercel.com/docs/functions/runtimes/bun), [Turso TypeScript client](https://docs.turso.tech/sdk/ts/reference), [Turso recovery](https://docs.turso.tech/cloud/point-in-time-recovery), [Resend domains](https://resend.com/docs/dashboard/domains/introduction).

## Verified Neon cutover: 16 November 2026

- Native Bun.SQL now serves `https://lacey.january.ie` from Neon Postgres 18.7.
  Deployment `dpl_DRb3KEakShWc3JPKFmCecS2o4EnW`, app revision `f5133c5`.
  Production resource `store_YjQV1uEkT1aayILC`; preview resource
  `store_5OLKFIVyEOl7bMwd`. Both were provisioned through Vercel on Neon Free,
  with authentication products disabled. No separate sign-up or manual copying
  of connection credentials is required to run the app.
- The encrypted full export copied all 17 data tables. Counts and SHA-256
  content checks matched every field, including 5 watches, 1 subscriber,
  1 feedback entry, all tokens/consent/suppression/receipt records, 61,643 shoe
  variants and 18,119 historical price observations. Schema checksums matched.
  The original Turso database remains frozen for customer writes and retained
  for recovery; it is not the live backend. Never unlock it casually or roll
  back to pre-Postgres code after the cutover.
- GitHub quality run `43953561083` passed 81 tests, builds, the failing-case
  SQLite browser guard and the real Postgres browser/subscription integration
  check. The guarded release passed its staged operational write probe and
  staged/public mobile and desktop browser checks. Public production smoke
  run `43954601487` also passed. No real test emails were sent.
- A new production scan completed in approximately 36 seconds. Actual observed
  inventory at that check is below; these are retailer listings, not a claim of
  unique models across shops. Quarantined and unsupported records remain excluded.

| Source | Normalized listings | Size variants checked | In stock | Sold out | Sale listings |
| --- | ---: | ---: | ---: | ---: | ---: |
| Amphibian King | 353 | 9,053 | 303 | 50 | 78 |
| The Run Hub | 1,153 | 7,553 | 432 | 721 | 148 |
| Elverys | 600 | 5,920 | 594 | 6 | 312 |
| Life Style Sports | 15 | 80 | 15 | 0 | 15 |

The Run Hub held 10 invalid records and excluded 23 unsupported products;
Life Style Sports remains deliberately limited. The API returned 630 grouped
offers / 553 sale listings after the fresh scan. The public browser recheck
loaded shoes, images and filters on both viewport sizes. Public responses may
briefly serve the previous snapshot under the documented CDN policy.

- The production encrypted backup endpoint was fetched and decrypted locally:
  5 watches, 1 subscriber and 1 feedback entry survived. The archive is private
  under `.data/backups/`. Independent retention completed successfully. Database
  size was about 65 MB, well below the provisioned free storage allowance.
- GitHub now has `LACEY_PG_DATABASE_URL`; both collection and nightly retention
  use Postgres. The 08:00/20:00 Dublin schedule and production email settings are
  preserved. Catalogue-only recovery run `43954778306` was started without email
  and is advancing a fresh 21RUN EU crawl. Do not report a complete 21RUN import
  until its snapshot is published. The older interrupted crawl exceeded its
  24-hour resume window and is not silently presented as fresh.
- MisterRunning and Running Warehouse remain blocked by product/link access;
  Sports Direct still needs a verified connector. Its canonical source URL is
  now `https://ie.sportsdirect.com`. This migration does not turn disconnected
  retailers into working feeds.

Neon's database is free within its plan limits; that does not imply unlimited
GitHub runner minutes or email delivery. The catalogue worker has a 90-minute
budget and checkpoints, so monitor actual Actions usage as coverage grows.
References: [Neon pricing](https://neon.com/pricing),
[Neon scale to zero](https://neon.com/docs/introduction/scale-to-zero).

Direct Vercel Git import needs the Vercel GitHub app to be granted access to the private repository; the initial connection attempt was denied. CI and scheduled jobs already run on GitHub. CLI build, deployment and promotion work independently of that optional connection.

## Verified cutover: 15 November 2026

- `https://lacey.january.ie` returns the Lacey app over valid HTTPS, without sign-in. All four authoritative nameservers return the expected CNAME. The apex and www are not associated with Lacey.
- The former Sites URL returns a 308 redirect to the same path/query at lacey.january.ie. Its D1 binding is retained; the last source check found zero watches and the single migrated feedback entry.
- Production and preview have distinct Turso URLs and tokens. All five initial SQL migrations applied, and a repeated migration applied zero changes while preserving data.
- 40 behavior tests and CI passed. Live desktop/mobile watch flows passed before email activation. A watch saved in production survived promotion of a new deployment and was removed only after verification.
- A production encrypted backup was fetched, authenticated and decrypted successfully. The deterministic GitHub workflow succeeded against Vercel, including upload of a 14-day encrypted backup artifact. The scheduler now targets the custom subdomain.
- A real confirmation from Lacey <lacey@january.ie> reached the owner’s Gmail. Gmail’s Authentication-Results report SPF, DKIM and DMARC passing. Gmail initially classified it as Spam; the owner was told to mark it Not spam. This is an inbox-placement issue to monitor, not a claim of guaranteed delivery for all recipients.
- Production sending is enabled with the dedicated key. The 50-attempt application budget applies; preview remains unable to send. No test watch or recurring test subscription was left behind.
- The existing BlockOps project remains unchanged. Direct Vercel Git import is still optional/pending repository authorization; tested CLI deployment and promotion are working.
