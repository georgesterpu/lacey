# Lacey

Use Bun for this repository's scripts, checks, builds and tests.

## Production releases

- Use `bun run release` from a clean, committed checkout. It requires passing
  GitHub checks for that exact revision, stages without assigning the live
  domain, tests the staged app against production data in a real browser, then
  promotes that exact deployment and checks the public domain.
- Do not bypass the gate with `vercel deploy --prod` or a separate manual
  promotion. A successful build or `/api/health` response alone is insufficient.
- A release must load nonempty shoe offers, render cards/images and populate
  working filters on mobile and desktop. Do not weaken the guard to get a release
  through; investigate empty/stale data or provider failures instead.
- A staged release must pass the operational database write probe as well as
  browser checks. It writes only the fixed `ops:readiness` key, never member data.
- Browser smoke checks are read-only. Do not submit watches, confirmations,
  unsubscribe links or real emails during a release check.
- Keep automatic main-branch deployment disabled. Native Git integration stays
  linked, while the guarded release command controls production promotion.
- Database migrations are explicit, backed up and additive. Never reset, seed
  over, or recreate production data to fix a loading failure.
- The approved Turso → Postgres migration copies to a new empty destination,
  compares every stored field, and retains the source for rollback. Never point
  integration fixtures at either production database. Database credentials and
  encrypted exports must remain ignored and private.

`bun run smoke:ci` checks production client assets and real libSQL/SQLite routes
with thousands of live rows plus a larger unpublished catalogue. It also proves
that the guard rejects empty data and broken JavaScript and that a stalled
request offers retry. `bun run smoke` checks the public production site.
CI also runs `scripts/check-postgres.ts` against an isolated Postgres service:
browser → API → native Bun.SQL → data, including confirmation, multiple watches,
sold-out checks, unsubscribe, backup and transaction rollback. This is required
alongside the SQLite checks, not a replacement for staged production checks.
