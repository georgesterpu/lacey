import { strict as assert } from "node:assert";
import { postgresClient } from "../src/postgres";
import { smokeFixture } from "./smoke-fixture";
import { verifySite } from "./browser-smoke";
import { currentDeals } from "../src/catalogue";
import { dashboardState } from "../src/dashboard-state";
import { handle } from "../src/server";
import { publicProductStatement } from "../src/public-catalogue";
import { planDigests, dispatchDigests } from "../src/outbox";
import { reserveDelivery } from "../src/email";
import { snapshot } from "../src/backup";
import { cleanup } from "../src/retention";
import { digest } from "../src/identity";
import { advanceCatalogue } from "../src/catalogue-job";
import { prepareDelivery } from "../src/preflight";
// A new schema in an explicitly designated TEST database. Never truncate or
// seed production, and do not give this check a Resend key.
const url = process.env.LACEY_TEST_DATABASE_URL;
assert.ok(url, "Set LACEY_TEST_DATABASE_URL to an isolated test database");
assert.ok(
  !new URL(url).hostname.includes("-pooler"),
  "Use a direct test connection so schema isolation survives",
);
const schema = `lacey_test_${crypto.randomUUID().replaceAll("-", "")}`;
const admin = postgresClient(url);
await admin.execute(`CREATE SCHEMA "${schema}"`);
const client = postgresClient(url, { schema });
const fetchOriginal = globalThis.fetch;
let fixture: Awaited<ReturnType<typeof smokeFixture>> | undefined;
try {
  assert.equal(
    (await client.execute("SELECT current_schema() name")).rows[0]?.name,
    schema,
    "Test schema was not selected; refusing to seed",
  );
  fixture = await smokeFixture(undefined, client);
  const { env } = fixture;
  await verifySite(fixture.url);
  assert.equal((await currentDeals(env)).length, 2000);
  const capability = "a".repeat(64),
    owner = `device:${await digest(capability)}`,
    cookie = `brave_device=${capability}`;
  const messages: { html: string }[] = [];
  globalThis.fetch = (async (input, init) => {
    if (String(input) === "https://api.resend.com/emails") {
      messages.push(JSON.parse(String(init?.body)));
      return Response.json({ id: "test-only" });
    }
    // The check must not make any unexpected external request.
    throw new Error("Unexpected network access in Postgres integration check");
  }) as typeof fetch;
  env.APP_URL = "https://lacey.test";
  env.RESEND_API_KEY = "fake-test-key";
  env.EMAIL_FROM = "Lacey <test@example.test>";
  const request = (path: string, method = "GET", data?: unknown) =>
    handle(
      new Request(env.APP_URL + path, {
        method,
        headers: { Cookie: cookie, "Content-Type": "application/json" },
        body: data === undefined ? undefined : JSON.stringify(data),
      }),
      env,
      "",
    );
  const watch = {
    kind: "category",
    query: "",
    category: "any",
    fit: "men",
    size: "8",
    budget: 10000,
    min_discount: 20,
    email: "runner@example.test",
    consent: true,
  };
  const first = await request("/api/watches", "POST", watch);
  assert.equal(first.status, 201);
  assert.equal((await first.json()).confirmation, "sent");
  assert.equal(messages.length, 1);
  const identity = await env.DB.prepare(
    "SELECT token FROM email_identities WHERE owner_id=?",
  )
    .bind(owner)
    .first<{ token: string }>();
  assert.ok(identity?.token);
  assert.equal(
    (await request(`/confirm-email?token=${identity.token}`, "POST")).status,
    200,
  );
  const second = await request("/api/watches", "POST", {
    ...watch,
    size: "8.5",
  });
  assert.equal((await second.json()).confirmation, "confirmed");
  assert.equal(
    messages.length,
    1,
    "A second watch must not send another confirmation",
  );
  assert.equal((await dashboardState(env, owner)).watches.length, 2);
  const run = await env.DB.prepare("SELECT id FROM scan_runs LIMIT 1").first<{
    id: string;
  }>();
  assert.ok(run);
  assert.equal((await planDigests(env, run.id)).planned, 1);
  assert.equal(
    (await planDigests(env, run.id)).planned,
    0,
    "A replay must not duplicate the digest",
  );
  const before = (await currentDeals(env)).length;
  const variants = await currentDeals(env);
  const queued = await env.DB.prepare(
    "SELECT candidates FROM digest_jobs LIMIT 1",
  ).first<{ candidates: string }>();
  const wanted = new Set(
    (JSON.parse(queued!.candidates) as { offerId: string }[]).map(
      (c) => variants.find((v) => v.id === c.offerId)!.product_id,
    ),
  );
  await env.DB.batch(
    [...wanted].map((id) =>
      env.DB.prepare(
        "INSERT INTO product_checks(run_id,source_id,product_id,status,checked_at,payload) VALUES(?,?,?,?,?,?)",
      ).bind(
        run.id,
        "amphibian",
        id,
        "ok",
        new Date().toISOString(),
        JSON.stringify(variants.filter((v) => v.product_id === id)),
      ),
    ),
  );
  env.REQUIRE_PREFLIGHT = true;
  assert.ok(
    (await prepareDelivery(env, run.id)).checked > 0,
    "The email server can consume fresh worker verification from Postgres",
  );
  // Exercise the real delivery SQL against Postgres, with only the provider
  // mocked. Planning and preflight alone do not test quota reservation.
  env.DAILY_EMAIL_LIMIT = "2";
  assert.equal((await dispatchDigests(env, run.id)).sent, 1);
  assert.equal(messages.length, 2, "One confirmation and one digest expected");
  assert.equal((await dispatchDigests(env, run.id)).sent, 0);
  assert.equal(messages.length, 2, "Replaying delivery must not send twice");
  assert.equal(await reserveDelivery(env), true, "The second quota slot is available");
  assert.equal(await reserveDelivery(env), false, "The global daily quota is enforced");
  await env.DB.batch([
    publicProductStatement(env, "amphibian", "0", []),
    env.DB.prepare(
      "INSERT INTO product_checks(run_id,source_id,product_id,status,checked_at,payload) VALUES(?,?,?,?,?,?) ON CONFLICT(run_id,source_id,product_id) DO UPDATE SET checked_at=excluded.checked_at,payload=excluded.payload",
    ).bind(run.id, "amphibian", "0", "ok", new Date().toISOString(), "[]"),
  ]);
  assert.equal(
    (await currentDeals(env)).length,
    before - 4,
    "Sold-out checks must exclude every size",
  );
  const catalogue = await (await request("/api/catalogue")).json();
  assert.ok(
    catalogue.offers.every((o: { product_id: string }) => o.product_id !== "0"),
  );
  const person = await env.DB.prepare(
    "SELECT unsubscribe_token FROM subscribers LIMIT 1",
  ).first<{ unsubscribe_token: string }>();
  assert.ok(person);
  assert.equal(
    (
      await request(
        `/unsubscribe-all?token=${person.unsubscribe_token}`,
        "POST",
      )
    ).status,
    200,
  );
  assert.equal(
    (
      await env.DB.prepare("SELECT sum(active) n FROM watches").first<{
        n: number;
      }>()
    )?.n,
    0,
  );
  const backup = await snapshot(client);
  assert.equal(backup.tables.watches.length, 2);
  assert.equal(backup.tables.subscribers.length, 1);
  await cleanup(env);
  const mrUrl =
    "https://www.misterrunning.com/en/mizuno-wave-sky-9-mens-running-shoes-cloudscape-blue-jewel-j1gc2502-61.html";
  const mrHtml = await Bun.file("fixtures/misterrunning-product.html").text();
  globalThis.fetch = (async (input) => {
    const url = String(input);
    assert.ok(url.startsWith("https://www.misterrunning.com/"));
    return new Response(
      url.endsWith("/robots.txt")
        ? "User-agent: *\nAllow: /"
        : url === mrUrl
          ? mrHtml
          : `<a href="${mrUrl}" data-products-price="€ 100,00" data-products-price-old="€ 160,00">Shoe</a>`,
    );
  }) as typeof fetch;
  assert.equal(
    (await advanceCatalogue(env, run.id, "misterrunning")).done,
    false,
  );
  assert.equal(
    (await advanceCatalogue(env, run.id, "misterrunning")).status,
    "complete",
  );
  assert.equal(
    (
      await env.DB.prepare(
        "SELECT product_count FROM sources WHERE id='misterrunning'",
      ).first<{ product_count: number }>()
    )?.product_count,
    1,
  );
  await assert.rejects(() =>
    client.batch([
      { sql: "INSERT INTO app_state VALUES('rollback-check','1')", args: [] },
      { sql: "INSERT INTO table_that_must_not_exist VALUES(1)", args: [] },
    ]),
  );
  assert.equal(
    await env.DB.prepare(
      "SELECT key FROM app_state WHERE key='rollback-check'",
    ).first(),
    null,
  );
  console.log(
    "Postgres: browser, 26,000 variants, email verification, immediate second watch, digest replay, sold-out check, unsubscribe, consistent backup and atomic rollback passed. No real emails sent.",
  );
} finally {
  globalThis.fetch = fetchOriginal;
  fixture?.close();
  await client.close();
  await admin.execute(`DROP SCHEMA "${schema}" CASCADE`);
  await admin.close();
}
