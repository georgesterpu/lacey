# Vercel and january.ie: handoff notes

The next hosting target is **january.ie**, with a planned verified sender of **george@january.ie**. Neither the domain nor the sender has been configured. Wait for the user's Vercel setup link and account access before provisioning or changing DNS.

## Where data lives today

Production runs on Sites/Cloudflare Workers with a managed **D1 database**, using SQLite SQL. This is persistent cloud storage, not a database file inside the browser or web bundle. Development uses Bun's native SQLite driver and `.data/brave.sqlite` on the local machine. The device cookie owns the private watchlist; the records themselves live in the database.

Vercel Functions cannot use a local SQLite file as a durable shared database: their local storage is ephemeral. The Vercel deployment needs external persistent storage and a compatible database adapter. The current D1 binding is specific to the Worker environment, so this is an actual migration step, not just copying the build output. Select and provision the database after reading the supplied Vercel setup instructions and reviewing current provider allowances. No provider or paid plan has been chosen on the user's behalf.

## Safe cutover order

1. Identify the Vercel project and provision external persistent storage. Take a backup/export of D1 and validate the destination schema and row counts.
2. Adapt the small SQL interface, run migrations and test the existing contract, matching, retention and email-outbox cases against the destination. Preserve subscriber consent, unsubscribe tokens, watch ownership and notification history.
3. Configure `APP_URL`, `CRON_SECRET`, `DAILY_EMAIL_LIMIT` and the verified email transport as server-side secrets/settings. The intended sender is `george@january.ie`; do not enable it before verification.
4. Verify the sender domain through the chosen email provider's required DNS records, including its SPF/DKIM configuration. Update confirmation/digest branding to Lacey and test actual inbox delivery and unsubscribe. Never put email-provider credentials in client JavaScript.
5. Test the new deployment before moving traffic. Then connect january.ie through Vercel's documented domain flow, update `APP_URL`, and change the existing GitHub scheduler's target URL/secret together.
6. Trigger the deterministic workflow once, read back source freshness and housekeeping completion, and verify the recipient cap and retry behavior. Keep a database backup and a rollback path until the new deployment is confirmed.

The current private GitHub repository and workflow paths retain the internal `shoehoo-jobs` name so scheduled jobs and secrets keep working. They are infrastructure identifiers, not the app's public branding. The existing public Sites URL is also retained until the domain cutover.

Primary reference: [Vercel on SQLite and ephemeral function storage](https://vercel.com/kb/guide/is-sqlite-supported-in-vercel).
