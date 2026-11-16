import { createClient } from "@libsql/client";
import { databaseAdapter } from "../src/database";
import { migrate } from "../src/migrations";
import { initializeSources } from "../src/scan";
import { offerStatements } from "../src/snapshots";
import { rebuildPublicCatalogue } from "../src/public-catalogue";
import { handle } from "../src/server";
import type { Env, Offer } from "../src/types";
import type { DatabaseClient } from "../src/database-client";

export async function smokeFixture(
  clientCode?: string,
  externalClient?: DatabaseClient,
) {
  const client: DatabaseClient =
    externalClient ?? createClient({ url: ":memory:", intMode: "number" });
  if (client.dialect !== "postgres")
    await client.execute("PRAGMA foreign_keys=ON");
  const journal = await Bun.file("drizzle/meta/_journal.json").json();
  await migrate(
    client,
    await Promise.all(
      journal.entries.map(async ({ tag }: { tag: string }) => ({
        tag,
        sql: await Bun.file(`drizzle/${tag}.sql`).text(),
      })),
    ),
  );
  const env: Env = { DB: databaseAdapter(client) };
  await initializeSources(env);
  const run = crypto.randomUUID(),
    now = new Date().toISOString(),
    snapshot = `${run}:amphibian`;
  await env.DB.prepare(
    "INSERT INTO scan_runs(id,slot_key,status,started_at,heartbeat_at,completed_at) VALUES(?,?,'complete',?,?,?)",
  )
    .bind(run, run, now, now, now)
    .run();
  const image =
    "data:image/svg+xml," +
    encodeURIComponent(
      '<svg xmlns="http://www.w3.org/2000/svg" width="100" height="70"><path d="M5 40h80l10 20H5z" fill="#6242b7"/></svg>',
    );
  const offer = (n: number): Offer => ({
    id: `amphibian:${n}`,
    source_id: "amphibian",
    product_id: String(Math.floor(n / 4)),
    title: `Running shoe ${Math.floor(n / 4)} Men`,
    brand: "ASICS",
    category: "daily",
    fit: "men",
    size_system: "UK",
    size: String(8 + (n % 4) * 0.5),
    colour: "Purple",
    price: 6000,
    reference_price: 10000,
    currency: "EUR",
    image,
    url: `https://www.amphibianking.ie/products/running-shoe-${Math.floor(n / 4)}?variant=${n}`,
    available: 1,
    checked_at: now,
  });
  // A real SQLite/libSQL adapter, real routes and the production client bundle.
  // Unpublished rows outnumber live rows, as they did in the incident.
  await env.DB.batch(
    offerStatements(
      env,
      run,
      Array.from({ length: 2000 }, (_, n) => offer(n)),
      snapshot,
    ),
  );
  await env.DB.batch(
    offerStatements(
      env,
      run,
      Array.from({ length: 24000 }, (_, n) => ({
        ...offer(n + 2000),
        title: "UNPUBLISHED — must never appear",
      })),
      `${run}:staged`,
    ),
  );
  await env.DB.prepare(
    "UPDATE sources SET status='live',live_snapshot_id=?,product_count=500,last_success=? WHERE id='amphibian'",
  )
    .bind(snapshot, now)
    .run();
  await env.DB.prepare("INSERT INTO app_state(key,value) VALUES('last_scan',?)")
    .bind(now)
    .run();
  await rebuildPublicCatalogue(env);
  const code = clientCode ?? (await Bun.file("dist/client/app.js").text());
  let mode:
    | "healthy"
    | "empty"
    | "broken-js"
    | "stalled"
    | "stalled-mail"
    | "stalled-watchlist" = "healthy";
  const server = Bun.serve({
    hostname: "127.0.0.1",
    port: 0,
    idleTimeout: 30,
    async fetch(request) {
      const path = new URL(request.url).pathname;
      if (path === "/api/watchlist" && mode === "stalled-watchlist")
        return new Promise<Response>(() => {});
      if (path === "/api/catalogue" && mode === "stalled")
        return new Promise<Response>(() => {});
      if (path === "/app.js" && mode === "broken-js")
        return new Response('throw new Error("Broken client fixture");', {
          headers: { "Content-Type": "text/javascript" },
        });
      if (mode === "stalled-mail" && path === "/api/watches/fixture/confirm")
        return new Promise<Response>(() => {});
      const response = await handle(request, env, code);
      if (
        (path === "/api/catalogue" || path === "/api/watchlist") &&
        mode === "stalled-mail"
      ) {
        const data = await response.json();
        data.emailReady = true;
        data.verifications = [{ watch_id: "fixture", status: "not_sent" }];
        return Response.json(data);
      }
      if (path === "/api/catalogue" && mode === "empty") {
        const data = await response.json();
        data.offers = [];
        return Response.json(data);
      }
      return response;
    },
  });
  return {
    url: server.url.origin,
    env,
    client,
    setMode(value: typeof mode) {
      mode = value;
    },
    close() {
      server.stop(true);
      client.close();
    },
  };
}
