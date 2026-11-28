# A private home for the boring, important bits

These workflow templates run the public application from a **separate private
GitHub repository**. Keep production credentials, execution logs and encrypted
customer backup artifacts there. The public source repository only runs code
checks and read-only website monitoring.

Copy `workflows/*.yml` into the private repository’s `.github/workflows/`.
Configure these repository variables:

| Variable | Value for your deployment |
| --- | --- |
| `LACEY_SOURCE_REPOSITORY` | Your public application repository, e.g. `owner/lacey` |
| `APP_URL` | Your live HTTPS origin |

Configure these **secrets**, without committing them:

- `LACEY_PG_DATABASE_URL`: the production Postgres connection URL.
- `CRON_SECRET`: the same scheduler secret configured on the deployed app.

The templates check out the public source only to resolve the live build’s
revision and its passing CI result. Database jobs then check out that exact
revision before receiving credentials. Cross-repository source checks are public
reads and don’t require sharing the private repository’s token.

Price checks target 08:07 and 20:07 Europe/Dublin, with catch-up at :37.
Retention targets 03:00. GitHub can delay scheduled events. Configure your own
timezone if needed, and keep the existing idempotent slot behaviour in mind.

The app needs its own Resend sender/key, `EMAIL_ENABLED`, and
`BACKUP_ENCRYPTION_KEY` in its server environment. The private scheduler receives
only encrypted backups. Keep an independent secure copy of the encryption key;
an encrypted export without its key cannot be restored.

Never enable backup artifact uploads in a public repository. Forks should use
isolated databases and their own credentials. See the [release and data safety
notes](../docs/incident-2026-11-18.md) for the boundaries these workflows preserve.
