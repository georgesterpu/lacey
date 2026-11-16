import { remoteClient, databaseAdapter } from "../src/database";
import { cleanup } from "../src/retention";
const client = remoteClient({ ...process.env, timeoutMs: 90000 }),
  env = { DB: databaseAdapter(client) };
const deadline = Date.now() + 10 * 60000;
let deleted = 0,
  total = 0;
try {
  do {
    ({ deleted } = await cleanup(env));
    total += deleted;
    console.log({ stage: "retention", deleted, total });
  } while (deleted && Date.now() < deadline);
  await env.DB.prepare(
    "INSERT INTO app_state(key,value) VALUES('cleanup_pending',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  )
    .bind(String(deleted > 0))
    .run();
  console.log(
    deleted
      ? "Maintenance budget reached; remaining pages resume next run."
      : "Retention caught up.",
  );
} finally {
  client.close();
}
