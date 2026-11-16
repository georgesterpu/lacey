# Lacey's stack

Verified against the installed tools, package registry and official documentation
on 16 November 2026. Lacey's application commands require Bun, not a separately
installed Node.js or Python runtime.

| Part | Implementation |
| --- | --- |
| Language | TypeScript 7.0.2, strict checking. Bun compiles the browser code to JavaScript. |
| Runtime and tools | Bun 1.4.4: server, HTTP requests, builds, package management, type checking, tests and job launcher. |
| UI | Plain TypeScript, HTML and CSS; no frontend framework. |
| Production hosting | Vercel's native Bun preset, `bunVersion: "1.4.x"`, Dublin region. Vercel supplies the runtime patch version. |
| Production database | Separate managed Turso/libSQL database; `@libsql/client` 0.18.0 over TLS. |
| Local/test database | Bun's built-in `bun:sqlite`, with in-memory databases in tests. |
| Scheduled work | GitHub Actions at 08:00/20:00 Europe/Dublin, with catch-up events and independent delivery/catalogue jobs. `bun run scan` executes `scripts/run-jobs.ts`. |
| Email | Resend's HTTP API, with no email SDK. |
| Browser QA | `Bun.WebView` driving an installed Chromium executable. No Playwright library is required by the repository. |

## How parsing works

The collectors and validators are TypeScript, executed by Bun on Vercel. The
GitHub launcher calls authenticated app endpoints; it does not perform scraping
itself. No LLM, Python process or browser automation runs during collection.

- Amphibian King, The Run Hub and Elverys: fetch public Shopify JSON feeds,
  validate their shape, then normalize prices, stock and explicitly known sizes.
- 21RUN: discover discounted products and pagination from embedded catalogue
  JSON in the EU sale HTML. Fetch the retailer's size-selector and product-offer
  JSON endpoints, then cross-check SKU, URL, department, colour, price and size.
- Life Style Sports: parse HTML metadata, embedded data and selected size links,
  then verify the selected variant. Coverage is intentionally limited.
- Running Warehouse's HTML parser exists but the source is disabled because
  customer links returned HTTP 406. MisterRunning and Sports Direct remain
  unconnected. Changing runtime does not solve these access/coverage gaps.

The HTML portions currently use targeted regular expressions and attribute
extraction, plus `JSON.parse` for embedded data. They do not use Cheerio,
BeautifulSoup or a general DOM parser. Bun's built-in HTMLRewriter is available
if an adapter needs more robust selector-based extraction; adopting it is a
separate parser change that needs fixtures and validation, not a version bump.

## Bun commands

```sh
bun install --frozen-lockfile
bun run check                     # bun check --no-script; TypeScript 7 semantics
bun test
bun run build:vercel
bun run dev
```

`bun check` contains the checker and standard library declarations itself.
The `typescript` package stays pinned to the version reported by
`bun -p process.versions.typescript` so editors can use the same rules. A normal
`bun run` transpiles TypeScript without checking it; CI explicitly checks first.

For external command-line packages, use `bunx --bun` to override Node shebangs:

```sh
bunx --bun vercel@65.16.0 project inspect --non-interactive
```

Use the same prefix for the deployment commands in the production runbook.
Keep the existing team/project checks, staging, verification and promotion steps.
GitHub's checkout/setup/upload actions have their own action runtimes; their
internal Node usage is distinct from running Lacey on Node.

Imports such as `node:fs/promises` and `node:assert` use Bun's compatible standard
library implementations. They do not start Node.js. Keep them where appropriate:
Bun's own file-I/O documentation recommends `node:fs` for directory operations.
The launcher uses `Bun.sleep` and Bun's compatible `fs` implementation to create
backups with explicit `0600` permissions; its integration test verifies this
with no executable on `PATH`. Builds use `Bun.build` and `Bun.write`; browser
checks use `Bun.WebView`. Bun's native formatter is available as `bun fmt` and
does not require Prettier. Use features that simplify the task rather than add
unrelated APIs for their own sake.

## Updates

The latest stable registry versions at this audit were Bun 1.4.4, TypeScript
7.0.2, `@types/bun` 1.4.4, `@libsql/client` 0.18.0 and Vercel CLI 65.16.0. The
project already had these versions. `bun update --latest` found no newer package
versions; `bun audit` found no reported vulnerabilities at the time of the check.

`package.json` is the Bun version source for both workflows. Exact package
versions and the lockfile keep successive runs reproducible. Update to new
releases deliberately, then commit the pins and lockfile together:

```sh
bun outdated
bun update --latest
bun run check
bun test
bun run build:vercel
bun audit
```

If Bun itself has a newer release, install it and update `packageManager` and
`engines.bun` as well. Recheck `process.versions.typescript`, editor alignment
and Vercel runtime support. Vercel manages its Bun patch version independently;
check the deployed runtime rather than assuming it equals the local executable.
Do not uninstall a workstation's shared Node installation as part of a project
upgrade. Node version numbers such as 26 are unrelated to Bun's 1.4 versioning.

This audit uses latest stable releases. Bun canaries and TypeScript `next`/beta
tags are prereleases and are not enabled in production. Test those in isolation
before adopting them; never let a floating nightly change a scheduled mail run.

## Official references

- [Bun 1.4.4 release](https://bun.sh/blog/bun-v1.4.4)
- [Bun type checking and TypeScript version alignment](https://bun.com/docs/runtime/check)
- [Bun Node.js compatibility](https://bun.sh/docs/runtime/nodejs-compat)
- [Bun file I/O](https://bun.com/docs/runtime/file-io)
- [bunx and the --bun flag](https://bun.sh/docs/pm/bunx)
- [Bun setup action and version selection](https://github.com/oven-sh/setup-bun)
- [TypeScript 7 release](https://devblogs.microsoft.com/typescript/announcing-typescript-7-0/)
