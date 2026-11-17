# Import audit: 17 November 2026

Production: <https://lacey.january.ie>. This records observed results, not a
promise of retailer availability. Numbers are retailer listings, independently
of grouping the same model across colours, sizes and shops in the interface.

## Published inventory

The small feeds were rerun at 07:39 Dublin on 17 November. MisterRunning completed
at 00:02 that day; 21RUN completed at 22:44 on 16 November. Stock totals describe
those exact observations. Deal counts below were read at the final audit and
can decrease after individual product verification.

| Shop | Normalized listings | Size variants checked | Listings in stock | Sold out | Current sale listings |
| --- | ---: | ---: | ---: | ---: | ---: |
| Amphibian King | 353 | 9,053 | 303 | 50 | 78 |
| The Run Hub | 1,163 | 7,622 | 439 | 724 | 153 |
| Elverys | 600 | 5,920 | 593 | 7 | 310 |
| Life Style Sports | 15 | 89 | 15 | 0 | 14 |
| 21RUN EU | 1,704 | 26,332 | 1,681 | 23 | 1,681 |
| MisterRunning | 1,361 | 8,936 | 953 | 408 | 951 |
| Sports Direct Ireland | No completed publication | — | — | — | 0 |
| Running Warehouse Europe | No fresh publication | — | — | — | 0 |

The public projection returned 3,354 grouped offers. Only available variants
discounted at least 20% are published. These are savings against each shop's
stated reference price, not a historical market-low claim. Superseded, failed,
unavailable and stale data are excluded.

## What changed

- **21RUN:** all 79 EU sale pages, 1,822 product pages checked. One conflicting
  Adidas listing is quarantined. The disabled final-page Next link no longer
  incorrectly restarts pagination. This is a completed import, not five samples.
- **MisterRunning:** all 63 men's/women's pages and 1,392 selected product pages
  checked. Full-price products are skipped from their explicit catalogue prices.
  Ended redirects are withheld. Tracking parameters and the final self-link are
  handled without weakening country/page validation. Two La Sportiva URLs end
  in old 56T/56Y codes while their pages identify ZFRS SKUs; those conflicts stay
  quarantined. Do not remove the identity check just to count two more products.
- **Run Hub:** real trademark characters in Shopify handles are encoded as one
  URL segment. All ten previously rejected products now parse; zero rejected
  records on the new run. Unsupported products remain excluded.
- **Sports Direct:** the canonical storefront is `https://ie.sportsdirect.com`.
  All rendered product links are discovered, beyond the ten SEO examples.
  Public server data supplies colour, SKU, stock and price; the parser supports
  real slash-containing slugs and the final CSS-disabled Next link. Discovery
  was checked through page 19. A full worker reached 198 products with no parser
  rejections, but the resumed worker received **HTTP 403**. Its incomplete
  snapshot remains unpublished. This is not a working production feed yet.
- **Warehouse:** real catalogue URLs replace fabricated product links. Ireland
  is selected using the shop's actual `POST vat=IE` form; customer URLs stay clean.
  Legacy checkpoint URLs are normalized too. Cloud diagnostics verified product
  sizes and Irish prices, but the full crawl still received **HTTP 406** after
  72 checked products. That staging snapshot remains unpublished.
- **Life Style Sports:** deliberately limited to five sale products per
  department and ten size options. It has not become full coverage.

Sports Direct and Warehouse stop on blocking and retain a 12-hour cooldown.
Do not rotate IPs, impersonate browsers, skip the block, or mark these imports
complete. Reliable coverage needs retailer-approved access or a stable permitted
feed if the normal worker continues to be refused. Native flag emoji remain
unchanged; their appearance depends on the reader's browser and operating system.

## Operation and verification

The Bun GitHub worker owns collection and pre-email stock verification. Vercel
serves the site and sends only from a fresh verification cache. It never probes
retailers from Vercel's different network. Each paged shop has its own job,
checkpoint, lease, bounded retry and atomic publication. A failed paged source
does not turn the small-feed scan into a failure or stop unrelated collectors.
An older interrupted cursor cannot supersede a newer successful publication.

Regression tests cover the observed parsing and orchestration failures. Browser
checks now exercise each published shop's filter and image host at mobile and
desktop widths, in addition to inventory arithmetic, freshness and link origin.
Releases still require exact-revision GitHub checks, a staged database write
probe, staged browsers and public browsers; no guard was weakened.

Neon is already provisioned and connected through Vercel. No additional account
or manual credential copying is needed. Storage measured **87 MB** during this
audit, including indexes and staging; storage is different from RAM. Retention
remains enabled. Production still has **5 watches, 1 subscriber and 1 feedback
entry**; member records were not reset or edited for this work. Catalogue-only
rechecks and browser checks did not request real test emails.

GitHub evidence: [completed 21RUN/MisterRunning recovery](https://github.com/georgesterpu/shoehoo-jobs/actions/runs/43979670680),
[product-level access samples](https://github.com/georgesterpu/shoehoo-jobs/actions/runs/43978725590),
[Sports Direct resumed-worker block](https://github.com/georgesterpu/shoehoo-jobs/actions/runs/44039970414).
See [connector contracts](retailer-connectors.md) and
[production reliability](production-reliability.md) for the ongoing rules.
