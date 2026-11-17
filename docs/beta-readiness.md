# Lacey: club-beta assessment

17 November 2026. This is a practical code and flow review, not a formal security
certification or a guarantee that retailers and email providers never fail.

## Recommendation

Use a **small, explicitly labelled club beta with 5–10 willing testers** after
the guarded release passes. Do not advertise complete coverage of eight shops,
guaranteed lowest prices, exact-minute delivery or guaranteed inbox placement.
There is already enough working stock from several shops to test the idea.
Another blocked retailer is not a reason to spend indefinitely on scraping.

The next useful learning is whether people create watches, receive relevant
finds and follow their links. Ask testers whether they found anything useful,
whether the size was right and whether they would keep the alerts switched on.
Use the existing feedback box. Avoid adding more features before learning this.

Before inviting the whole club, observe at least two successful scheduled
collection/delivery cycles, confirm a genuine requested email reaches the owner,
and review the first testers' feedback. Do not create real test subscriptions or
send messages to members as part of automated QA.

## Follow-up fixes

- Life Style's original five-products/ten-sizes caps were real implementation
  limits, not the shop's total stock. Removing them yielded **48 normalized
  listings, 215 checked variants and 46 current sale listings** in the 08:08
  refresh, with zero rejected products. The previous result was 14 sale listings.
  Further category pagination is disallowed by the retailer's robots rules, so
  entry-page coverage is still labelled limited. The collector is paced and
  bounded; it does not rewrite a disallowed query to evade the policy.
- Warehouse's actual popup is a public POST form with `lang=en` and `vat=IE`.
  It sets a first-party `SMID` session. The connector now selects the preferences
  once, retains its own anonymous cookie and requests shoes with GET. Previously
  every shoe independently reposted VAT without retaining the session. Local
  checks verified the supplied Boston 13 link and the ASICS page where the
  previous crawl stopped. The cloud diagnostic also verified the Boston page,
  but the full scheduled-worker retry still returned **HTTP 406**. Warehouse
  remains unavailable for this beta. A working sample does not lift its blocked
  status; no further block-bypassing attempts are justified for this pilot.
- Selecting an unavailable shop explains that it could not be checked and gives
  a route back to other shops. It no longer claims that there are no deals there.
  Unconfirmed shop sizes have a separate route to browse without a UK filter;
  the app still never guesses a UK conversion or silently enables such alerts.
- Form throttling uses the client address supplied by Vercel, rather than an
  overriding client-supplied Cloudflare header. The regression check proves that
  changing the forged header cannot create another allowance.
- Native HTTP connection failures are classified as retryable transport errors,
  rather than quarantined as malformed products or silently omitted from a
  source with otherwise valid records.
- The obsolete browser script that wrote synthetic records to an arbitrary
  remote database was removed. State-changing interactive QA requires a local
  app. CI's native Postgres flow creates and removes an isolated test schema;
  public production smoke checks remain read-only.

## Reviewed boundaries and evidence

| Boundary | What is checked |
| --- | --- |
| Catalogue → UI | Nonempty fresh offers, all eight source reports, inventory arithmetic, source URL origins, actual cards/images and filters at mobile/desktop widths |
| Shop failure → UI | Blocked shop is distinguished from no matches; switching back restores offers |
| Sizes → watch | Adult/child separation, explicit units, store-bound unknown sizes, selected-variant identity, budget and discount validation |
| Signup → confirmation | Automatic send, one verification per browser/address, native signed POST, multiple watches, uncertain-send token/idempotency reuse |
| Watch → digest | Indexed matching, cross-shop/size grouping, fresh worker stock cache, consent and suppression rechecks, durable recipient/model receipts |
| Digest → provider | Fake-provider integration tests, stable retry key, shared product checks, frozen retry payload and bounded attempts; real inbox placement is not inferred from tests |
| Unsubscribe → data | Visible HTML button, signed GET confirmation, email-client one-click POST, immediate suppression and stopped watches |
| Deploy → database | Exact-revision CI, checksummed migrations, staged operational write probe, same-build promotion and public browser verification with rollback |
| Recovery | Verified Neon migration, separate preview data, encrypted member backups, restoration tests, retention independent of imports |

The code review covered request validation and ownership, SQL binding and
transactions, public/private responses, collection/publication, matching,
verification, email retries/consent, backups/retention and release/workflow
boundaries. Parser fixtures and native Postgres integration supply regression
evidence. No broad rewrite, dependency upgrade or database migration was needed.

## Known limits before a wider launch

- Source coverage varies; the live shop cards and timestamps are authoritative.
  Sports Direct and Warehouse remain optional while their workers are blocked.
  Neither is required to test watches against the six publishing shops.
- Savings use each shop's reference price. Delivery costs and promotions can
  change; the destination shop confirms the final purchase price and stock.
  Automatic coupon discovery/stacking and delivery-inclusive ranking are not
  implemented.
- Email verification is browser/address scoped. A new browser needs verification;
  it does not import a watchlist from another device. This is deliberate for the
  account-free beta, but should be explained if testers find it confusing.
- GitHub targets 08:00/20:00 Dublin with catch-up and idempotent slots. Scheduled
  jobs can be delayed or dropped by the platform; these are target times, not a
  delivery SLA. Keep the health/browser checks and failure notifications active.
- Watch actual runner minutes, database storage and Resend usage. Free services
  are bounded. Bounce/complaint webhook automation, stronger signup-abuse controls
  and alerting independent of GitHub should precede a substantially larger launch.

References: [Vercel's platform-supplied IP headers](https://vercel.com/docs/headers/request-headers),
[GitHub scheduled-workflow delays](https://docs.github.com/en/actions/how-tos/troubleshoot-workflows),
[Life Style robots rules](https://www.lifestylesports.com/robots.txt),
[Warehouse's public preference-form script](https://static.runningwarehouse.eu/js/default.js?ver=594).
