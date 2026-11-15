# Lacey production: Vercel and january.ie

Vercel project **lacey**, ID `prj_dMJPR26hdpOfYyHecvwO6aMNeiNi`, under **george-sterpus-projects**. It is independent of `blockops`; no BlockOps settings, credentials or storage are reused. The sender is **Lacey <lacey@january.ie>**. The canonical website is **https://january.ie**, with www redirecting to it. The temporary production alias is **https://lacey-january.vercel.app**.

## Persistent data

Production uses **Turso managed libSQL (SQLite)** in Dublin, connected through Vercel Marketplace on its $0 Starter plan. Preview and development use a different database, **lacey-preview**, also in Dublin. Production credentials are scoped to production; no database file is stored in Vercel’s ephemeral filesystem. Bun 1.4 runs the existing app through a small transactional SQL adapter; there is no Postgres conversion or browser-accessible database credential.

`src/database.ts` converts the existing prepared-statement interface to the libSQL client, including atomic batch transactions. `server.ts` is the native Bun framework entrypoint. `bun run build:vercel` bundles the application without touching the database. App builds, preview creation, promotions and code rollbacks do not recreate, seed, wipe, or restore production data.

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

The previous deployment remains on managed Cloudflare D1 while DNS is being completed. A private, complete export of the member-data tables was taken before import. It contained **zero watches/subscribers and one feedback entry**. `scripts/import-sites-data.ts` imported the feedback and checked every member-table row count in a transaction. It refuses truncated exports, populated destinations and unsupported historical-job references. The old catalogue is recollected from the approved sources rather than copied as stale offers. No member data was invented or discarded.

After DNS is live, redirect the old Sites app to the canonical domain so it cannot accumulate a separate watchlist. Keep its D1 data until the transition is verified.

## Email setup and privacy

The production sender is `Lacey <lacey@january.ie>`, with a dedicated Resend Sending-access key restricted to january.ie. The account’s existing Resend plan and sending reputation are shared at the provider level; this does not reuse BlockOps’ API key. Preview/development can never send, even if email credentials are mistakenly copied there. `EMAIL_ENABLED` is an explicit production kill switch and stays false until sender/DNS validation is finished. The app’s attempt budget is 50 per day initially, leaving headroom in the shared free email account.

The user is configuring Resend in its dashboard and will add its exact DKIM/return-path records at the authoritative DNS host. Sending from a verified address does not create a receiving mailbox at the domain host. Incoming-mail MX records are separate and are not replaced by this deployment.

Emails are kept behind server-side credentials. The public API does not expose addresses; private watch management uses a random HttpOnly, Secure, SameSite cookie. Consent and email confirmation precede alerts. Token links provide unsubscribe without sign-in. Provider transport, member-data retention and access should be reviewed before a wider launch; bounce/complaint webhooks remain a documented next step.

## Scheduler and isolation

The existing private GitHub repository `georgesterpu/shoehoo-jobs` remains the source/CI/scheduler repository. The deterministic runner targets 08:00 and 20:00 Europe/Dublin, with catch-up triggers and a fresh Lacey-only `CRON_SECRET`. After the Vercel cutover, its `APP_URL` points to the Vercel production alias until the custom domain resolves, then to january.ie. It has no LLM dependency. The earlier ChatGPT task still requires separate account cleanup if enabled; it is not used by this runner.

BlockOps’ environment variables, storage and project configuration are unchanged. Vercel/Turso account limits and the Resend account quota are shared account-level limits even though project data and app keys are isolated.

## Website DNS

The authoritative nameservers remain with the existing host. Vercel returned these records for this project:

| Type | Name | Value |
| --- | --- | --- |
| A | @ | 216.198.79.1 |
| A | @ | 64.29.17.1 |
| CNAME | www | 437124a36273bfa8.vercel-dns-017.com |

The project owns both domain associations, with www redirecting to january.ie. Ownership verification and DNS/HTTPS readiness are distinct; check both before declaring the custom domain live. Do not replace unrelated TXT/MX records or change nameservers.

References: [Vercel Bun runtime](https://vercel.com/docs/functions/runtimes/bun), [Turso TypeScript client](https://docs.turso.tech/sdk/ts/reference), [Turso recovery](https://docs.turso.tech/cloud/point-in-time-recovery), [Resend domains](https://resend.com/docs/dashboard/domains/introduction).
