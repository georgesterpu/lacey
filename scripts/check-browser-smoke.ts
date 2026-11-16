import { strict as assert } from "node:assert";
import { verifySite } from "./browser-smoke";
import { smokeFixture } from "./smoke-fixture";
const fixture = await smokeFixture();
try {
  await verifySite(fixture.url);
  fixture.setMode("stalled-mail");
  await verifySite(fixture.url);
  console.log("Shoes render even when legacy email repair is stalled.");
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
