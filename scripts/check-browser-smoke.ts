import { strict as assert } from "node:assert";
import { verifySite } from "./browser-smoke";
import { smokeFixture } from "./smoke-fixture";
const fixture = await smokeFixture();
try {
  await verifySite(fixture.url);
  const saved=await fixture.env.DB.prepare("SELECT value FROM app_state WHERE key='public:shop:amphibian'").first<{value:string}>();
  const cached=JSON.parse(saved!.value);cached.source.status='cached';
  for(const groups of Object.values(cached.products)as any[][])for(const offer of groups)offer.size_system='unknown';
  await fixture.env.DB.prepare("UPDATE app_state SET value=? WHERE key='public:shop:amphibian'").bind(JSON.stringify(cached)).run();
  await verifySite(fixture.url);
  await fixture.env.DB.prepare("UPDATE app_state SET value=? WHERE key='public:shop:amphibian'").bind(saved!.value).run();
  console.log('Cached browsing retains the shop-size recovery path.');
  fixture.setMode("stalled-mail");
  await verifySite(fixture.url);
  console.log("Shoes render even when legacy email repair is stalled.");
  fixture.setMode("stalled-watchlist");
  await using privateStall = new Bun.WebView({
    width: 390,
    height: 844,
    backend: { type: "chrome", path: process.env.BUN_CHROME_PATH, url: false },
  });
  await privateStall.navigate(fixture.url);
  const visibleBy = Date.now() + 3000;
  while (
    Date.now() < visibleBy &&
    !(await privateStall.evaluate(
      'document.querySelectorAll(".product-card").length>0',
    ))
  )
    await Bun.sleep(100);
  assert.ok(
    await privateStall.evaluate(
      'document.querySelectorAll(".product-card").length>0',
    ),
    "A stalled private watchlist must not block public shoes",
  );
  fixture.setMode("empty");
  await assert.rejects(() => verifySite(fixture.url), /no shoe offers/);
  fixture.setMode("broken-js");
  await assert.rejects(
    () => verifySite(fixture.url, 1500),
    /No shoes rendered/,
  );
  fixture.setMode("stalled");
  await using view = new Bun.WebView({
    width: 390,
    height: 844,
    backend: { type: "chrome", path: process.env.BUN_CHROME_PATH, url: false },
  });
  await view.navigate(fixture.url);
  const deadline = Date.now() + 13000;
  while (
    Date.now() < deadline &&
    !(await view.evaluate(
      '!!document.querySelector("[data-action=retry-load]")',
    ))
  )
    await Bun.sleep(100);
  assert.ok(
    await view.evaluate('!!document.querySelector("[data-action=retry-load]")'),
    "Stalled requests must leave loading state and offer retry",
  );
  fixture.setMode("healthy");
  await view.evaluate(
    'document.querySelector("[data-action=retry-load]").scrollIntoView({block:"center"})',
  );
  await view.click("[data-action=retry-load]");
  const recovered = Date.now() + 5000;
  while (
    Date.now() < recovered &&
    !(await view.evaluate(
      'document.querySelectorAll(".product-card").length>0',
    ))
  )
    await Bun.sleep(100);
  assert.ok(
    await view.evaluate('document.querySelectorAll(".product-card").length>0'),
    "Retry did not recover shoes",
  );
  console.log(
    "Smoke guard rejects empty data and broken JavaScript; stalled requests show retry and recover.",
  );
} finally {
  fixture.close();
}
