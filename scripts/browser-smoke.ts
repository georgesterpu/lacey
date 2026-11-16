import { strict as assert } from "node:assert";

// Read-only: no watch, verification, unsubscribe or feedback request is made.
export async function verifySite(base: string, renderBudgetMs = 8000) {
  const start = performance.now();
  const response = await fetch(new URL("/api/dashboard", base), {
    signal: AbortSignal.timeout(5000),
  });
  assert.equal(
    response.status,
    200,
    "Deals API must return HTTP 200 within five seconds",
  );
  const data = (await response.json()) as {
    offers: {
      title: string;
      price: number;
      reference_price: number;
      url: string;
      sizes: string[];
      source_id: string;
    }[];
    sources: { id: string; url: string }[];
    watches: unknown[];
  };
  assert.ok(
    Array.isArray(data.offers) && data.offers.length > 0,
    "Deals API returned no shoe offers",
  );
  assert.equal(
    data.watches.length,
    0,
    "Anonymous smoke check must not see saved watches",
  );
  for (const offer of data.offers) {
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
    console.log(
      `Browser ${width}px: shoes, images and filters loaded in ${Math.round(performance.now() - rendered)}ms`,
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
    ["/api/dashboard", "application/json"],
  ]);
  return Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (request.method !== "GET" || !paths.has(path))
        return new Response("Read-only smoke bridge", { status: 405 });
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
        ],
        { stdout: "pipe", stderr: "pipe" },
      );
      const [code, body] = await Promise.all([
        child.exited,
        new Response(child.stdout).text(),
        new Response(child.stderr).text(),
      ]);
      return new Response(code === 0 ? body : "Staged request failed", {
        status: code === 0 ? 200 : 502,
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
