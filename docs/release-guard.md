# Production release guard

Use `bun run release` from a clean, committed checkout. Set `BUN_CHROME_PATH` to
an installed Chromium/Chrome executable if it is not automatically found by Bun.
The Vercel CLI and GitHub CLI must already be authenticated.

The release command requires the exact commit's GitHub checks to pass. It stages
with production environment/database and `--skip-domain`, runs read-only API and
real browser checks against that deployment, then promotes that exact build. If
the public domain fails its post-promotion check, it restores the previous
production deployment. An error before promotion leaves the public alias alone.

The guard requires:

- HTTP 200 and nonempty shoe offers within five seconds from the deals API.
- Shoe facts, sizes and direct purchase links belonging to the named shop.
- Cards, at least one loaded shoe image, populated/working filters and no
  horizontal overflow in mobile and desktop browsers.
- Loading to finish, rather than a successful HTML response with a stuck client.

It never creates watches, sends email or clicks verification/unsubscribe links.
Public catalogue responses and private watch responses are tested separately.
The guard checks all eight coverage reports and their deal counts, timestamps
and inventory arithmetic against the returned offers.
Protected staging requests retain Vercel authentication; a loopback-only bridge
uses authenticated `vercel curl` for five GET paths. No protection settings are
weakened and no new permanent bypass credential is required.

GitHub's quality workflow runs the same browser guard with production client
assets and real libSQL/SQLite routes, 2,000 live variants and 24,000 unpublished
variants. It proves that empty data and broken JavaScript fail the guard. A
stalled request must show retry and recover when retried. Failed browser runs
retain screenshots for seven days. The independent production smoke workflow
also checks the real public site around the morning/evening checks.

## 16 November incident

The public HTML and health endpoint returned 200 while `/api/dashboard` hung.
The UNION view's query plan scanned catalogue rows that were not published.
The new read first selects live shops and seeks each exact published snapshot
by its primary key. The live database returned 2,045 eligible variants in roughly
one second during diagnosis.

A separate source scan timed out after 240 seconds after writing only part of a
snapshot. One SQL statement was being issued per size inside remote batches.
Snapshots now insert up to 50 variants per parameterized SQL statement (950 parameters), in bounded transactions;
publication remains atomic and incomplete snapshots stay hidden.

The failed catalogue-only workflow unnecessarily started that source scan, then
failed because it was still running. Catalogue-only jobs now reuse an existing
scan namespace and never start or wait for source collection.

These guards block the known failure modes and stop unverified promotions. They
do not guarantee that hosting, database, retailer or network services can never
fail after a release. The production check detects later failures; investigate
rather than weakening the nonempty/latency checks to make a release pass.

Collection, caching and inventory reporting are documented in [production-reliability.md](production-reliability.md).
