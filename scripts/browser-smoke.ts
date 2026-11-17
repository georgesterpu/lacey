import { strict as assert } from "node:assert";

// Read-only: no watch, verification, unsubscribe or feedback request is made.
export async function verifySite(base: string, renderBudgetMs = 8000) {
  const start = performance.now();
  const response = await fetch(new URL("/api/catalogue", base), {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(
    response.status,
    200,
    "Deals API must return HTTP 200 within five seconds",
  );
  const data = (await response.json()) as {
    offers: {
      product_id: string;
      available: number;
      checked_at: string;
      title: string;
      price: number;
      reference_price: number;
      url: string;
      sizes: string[];
      source_id: string;
      size_system: string;
    }[];
    sources: {
      id: string;
      status: string;
      url: string;
      product_count: number;
      current_deals: number;
      last_success: string | null;
      inventory?: {
        products: number;
        variants: number;
        availableProducts: number;
        soldOutProducts: number;
      } | null;
    }[];
    watches: unknown[];
  };
  assert.ok(
    Array.isArray(data.offers) && data.offers.length > 0,
    "Deals API returned no shoe offers",
  );
  assert.equal(
    data.watches,
    undefined,
    "Public catalogue must never contain watch data",
  );
  const privateResponse = await fetch(new URL("/api/watchlist", base), {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(privateResponse.status, 200, "Private watchlist API failed");
  const privateData = await privateResponse.json();
  assert.equal(
    privateData.watches.length,
    0,
    "Anonymous smoke check must not see saved watches",
  );
  assert.equal(
    new Set(data.sources.map((s) => s.id)).size,
    8,
    "All eight shops must have distinct coverage reports",
  );
  for (const source of data.sources) {
    assert.ok(
      Number.isInteger(source.product_count) && source.product_count >= 0,
      "Invalid inventory count",
    );
    assert.equal(
      source.current_deals,
      new Set(
        data.offers
          .filter((o) => o.source_id === source.id)
          .map((o) => o.product_id),
      ).size,
      "Shop deal count does not match published listings",
    );
    if (source.last_success)
      assert.ok(
        Number.isFinite(Date.parse(source.last_success)),
        "Invalid shop check time",
      );
    if (source.inventory) {
      const i = source.inventory;
      assert.equal(
        i.products,
        i.availableProducts + i.soldOutProducts,
        "Stock totals disagree",
      );
      assert.equal(
        i.products,
        source.product_count,
        "Inventory summary belongs to a different publication",
      );
      assert.ok(i.variants >= i.products, "Invalid size count");
    }
  }
  for (const offer of data.offers) {
    assert.equal(offer.available, 1, "Sold-out variants cannot be published");
    assert.ok(
      Date.parse(offer.checked_at) >= Date.now() - 30 * 3600000,
      "Stale shoe offer",
    );
    assert.ok(
      offer.title &&
        offer.price > 0 &&
        offer.reference_price > offer.price &&
        offer.sizes?.length,
      "Shoe facts are incomplete",
    );
    const source = data.sources.find((s) => s.id === offer.source_id);
    assert.ok(
      source &&
        new URL(offer.url).protocol === "https:" &&
        new URL(offer.url).origin === new URL(source.url).origin,
      "Purchase link must belong to the named shop",
    );
  }
  console.log(
    `Deals API: ${data.offers.length} offers in ${Math.round(performance.now() - start)}ms`,
  );
  for (const width of [390, 1280]) {
    await using view = new Bun.WebView({
      width,
      height: 900,
      backend: {
        type: "chrome",
        path: process.env.BUN_CHROME_PATH,
        url: false,
      },
    });
    const rendered = performance.now();
    await view.navigate(base);
    const deadline = Date.now() + renderBudgetMs;
    while (
      Date.now() < deadline &&
      !(await view.evaluate(
        'document.querySelectorAll(".product-card").length>0',
      ))
    )
      await Bun.sleep(100);
    await Bun.write(`screenshots/smoke-${width}.png`, await view.screenshot());
    assert.ok(
      await view.evaluate(
        'document.querySelectorAll(".product-card").length>0',
      ),
      `No shoes rendered at ${width}px; loading or broken JavaScript`,
    );
    assert.ok(
      await view.evaluate(
        '!document.querySelector("#scan-status").textContent.includes("Loading")',
      ),
      "Loading indicator did not finish",
    );
    assert.ok(
      await view.evaluate(
        'document.querySelector("#filter-brand").options.length>1',
      ),
      "Brand filter did not populate",
    );
    assert.equal(
      await view.evaluate('document.querySelectorAll(".source-card").length'),
      data.sources.length,
      "Shop coverage cards did not load",
    );
    assert.equal(
      await view.evaluate("document.documentElement.scrollWidth>innerWidth"),
      false,
      "Horizontal overflow",
    );
    await view.evaluate(
      '(()=>{const f=document.querySelector("#filter-brand");f.value=f.options[1].value;f.dispatchEvent(new Event("change",{bubbles:true}));})()',
    );
    assert.ok(
      await view.evaluate(
        'document.querySelectorAll(".product-card").length>0',
      ),
      "Changing a filter broke the shoe list",
    );
    const imageDeadline = Date.now() + 5000;
    while (
      Date.now() < imageDeadline &&
      !(await view.evaluate(
        '[...document.querySelectorAll(".product-card img")].some(i=>i.complete&&i.naturalWidth>0)',
      ))
    )
      await Bun.sleep(100);
    assert.ok(
      await view.evaluate(
        '[...document.querySelectorAll(".product-card img")].some(i=>i.complete&&i.naturalWidth>0)',
      ),
      "No shoe image loaded",
    );
    // A working image from one shop must not hide a broken new image host or
    // an individual-shop filter that silently drops another published feed.
    for (const source of data.sources.filter((s) => s.current_deals > 0)) {
      await view.evaluate(`(()=>{const b=document.querySelector('#filter-brand'),s=document.querySelector('#filter-region');b.value='any';s.value=${JSON.stringify(`shop:${source.id}`)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      assert.ok(await view.evaluate('document.querySelectorAll(".product-card").length>0'), `No cards for ${source.id} at ${width}px`);
      const until = Date.now() + 5000;
      while (Date.now() < until && !(await view.evaluate('[...document.querySelectorAll(".product-card img")].some(i=>i.complete&&i.naturalWidth>0)')))
        await Bun.sleep(100);
      assert.ok(await view.evaluate('[...document.querySelectorAll(".product-card img")].some(i=>i.complete&&i.naturalWidth>0)'), `No ${source.id} shoe image loaded at ${width}px`);
      if(data.offers.filter(o=>o.source_id===source.id).every(o=>o.size_system==='unknown')){
        await view.evaluate(`(()=>{const f=document.querySelector('#filter-size');f.value='9';f.dispatchEvent(new Event('change',{bubbles:true}));})()`);
        assert.ok(await view.evaluate('!!document.querySelector("#products [data-action=all-sizes]")'), 'Unconfirmed size units need a clear recovery path');
        await view.evaluate('document.querySelector("#products [data-action=all-sizes]").click()');
        assert.ok(await view.evaluate('document.querySelectorAll(".product-card").length>0'), 'Browse all sizes did not recover the shoe list');
      }
    }
    const unavailable = data.sources.find(s=>s.current_deals===0&&!['live','partial'].includes(s.status));
    if(unavailable){
      await view.evaluate(`(()=>{const s=document.querySelector('#filter-region');s.value=${JSON.stringify(`shop:${unavailable.id}`)};s.dispatchEvent(new Event('change',{bubbles:true}));})()`);
      assert.ok(await view.evaluate('!!document.querySelector("#products [data-action=all-shops]")'), 'An unchecked shop must explain its status rather than claim no matching deals');
      await view.evaluate('document.querySelector("#products [data-action=all-shops]").click()');
      assert.ok(await view.evaluate('document.querySelectorAll(".product-card").length>0'), 'Browse other shops did not recover the shoe list');
    }
    console.log(
      `Browser ${width}px: shoes, images and individual-shop filters loaded in ${Math.round(performance.now() - rendered)}ms`,
    );
  }
}

// Protected staging deployments retain Vercel authentication. This loopback
// bridge uses the authenticated CLI and forwards only four read-only paths.
export async function protectedSite(deployment: string) {
  const paths = new Map([
    ["/", "text/html; charset=utf-8"],
    ["/app.js", "text/javascript; charset=utf-8"],
    ["/style.css", "text/css; charset=utf-8"],
    ["/api/catalogue", "application/json"],
    ["/api/watchlist", "application/json"],
  ]);
  const bodies = new Map<string, string>();
  // Measure the origin request itself, excluding CLI sign-in/startup overhead.
  // All bodies still come from this exact protected production deployment.
  await Promise.all(
    [...paths.keys()].map(async (path) => {
      const child = Bun.spawn(
        [
          "bunx",
          "--bun",
          "vercel@65.16.0",
          "curl",
          path,
          "--deployment",
          deployment,
          "--",
          "--silent",
          "--show-error",
          "--fail",
          "--max-time",
          "10",
          "--write-out",
          "\n%{http_code} %{time_total}",
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [code, raw] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      assert.equal(code, 0, `Staged GET ${path} failed`);
      const split = raw.lastIndexOf("\n"),
        [status, seconds] = raw
          .slice(split + 1)
          .trim()
          .split(" ");
      assert.equal(status, "200", `Staged GET ${path} did not return HTTP 200`);
      if (path.startsWith("/api/")) {
        assert.ok(
          Number(seconds) <= 5,
          `Staged deals API took ${seconds}s; budget is 5s`,
        );
        console.log(
          `Staged origin deals API: ${Math.round(Number(seconds) * 1000)}ms`,
        );
      }
      bodies.set(path, raw.slice(0, split));
    }),
  );
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      if (request.method !== "GET" || !paths.has(path))
        return new Response("Read-only smoke bridge", { status: 405 });
      return new Response(bodies.get(path), {
        headers: {
          "Content-Type": paths.get(path)!,
          "Cache-Control": "no-store",
        },
      });
    },
  });
}

if (import.meta.main) {
  const deployment = process.env.STAGED_DEPLOYMENT;
  const proxy = deployment ? await protectedSite(deployment) : undefined;
  try {
    await verifySite(
      proxy?.url.origin ?? process.env.APP_URL ?? "https://lacey.january.ie",
    );
  } finally {
    proxy?.stop(true);
  }
}
