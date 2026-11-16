import { jsonField } from "./sql-json";
import type { Env } from "./types";
import { releaseUnsentRecommendations } from "./recommendations";
// Small, independently committed pages keep maintenance out of the publishing
// transaction and prevent a large backlog holding the writer indefinitely.
export async function cleanup(env: Env, now = new Date()) {
  const current = now.toISOString(),
    twoDays = new Date(+now - 2 * 86400000).toISOString(),
    sevenDays = new Date(+now - 7 * 86400000).toISOString(),
    ninetyDays = new Date(+now - 90 * 86400000).toISOString(),
    sixHours = new Date(+now - 6 * 3600000).toISOString();
  const expired = (
    await env.DB.prepare(
      "SELECT id FROM digest_jobs WHERE status IN('queued','sending') AND created_at<? LIMIT 100",
    )
      .bind(sixHours)
      .all<{ id: string }>()
  ).results;
  for (const job of expired) await releaseUnsentRecommendations(env, job.id);
  const query = (sql: string, ...args: unknown[]) => ({ sql, args });
  const keys = {
    notifications: "id",
    offers: "id",
    offer_snapshots: "snapshot_id,id",
    product_checks: "run_id,source_id,product_id",
    price_history: "offer_id,observed_at",
    digest_jobs: "id",
    source_runs: "run_id,source_id",
    scan_runs: "id",
    email_confirmations: "watch_id",
    delivery_budget: "day",
    app_state: "key",
  };
  const prune = (
    table: keyof typeof keys,
    where: string,
    ...args: unknown[]
  ) => {
    const columns = keys[table],
      key = columns.includes(",") ? `(${columns})` : columns;
    return query(
      `DELETE FROM ${table} WHERE ${key} IN(SELECT ${columns} FROM ${table} WHERE ${where} LIMIT 100)`,
      ...args,
    );
  };
  const queries = [
    query(
      "UPDATE digest_jobs SET status='suppressed',error='Scan expired',payload=NULL,candidates='[]' WHERE id IN(SELECT id FROM digest_jobs WHERE status IN('queued','sending') AND created_at<? LIMIT 100)",
      sixHours,
    ),
    query(
      "UPDATE digest_jobs SET payload=NULL,candidates='[]' WHERE status IN('sent','suppressed','failed') AND created_at<? AND (payload IS NOT NULL OR candidates!='[]')",
      twoDays,
    ),
    prune("notifications", "created_at<?", ninetyDays),
    query(
      "UPDATE sources SET live_snapshot_id=NULL WHERE live_snapshot_id IS NOT NULL AND (last_success IS NULL OR last_success<?)",
      twoDays,
    ),
    prune(
      "offers",
      "source_id IN(SELECT id FROM sources WHERE live_snapshot_id IS NOT NULL) OR checked_at<?",
      twoDays,
    ),
    // Seek expiry dates rather than scanning all staged size rows. A live
    // pointer or active crawl always protects its snapshot.
    prune(
      "offer_snapshots",
      `checked_at<? AND snapshot_id NOT IN(SELECT live_snapshot_id FROM sources WHERE live_snapshot_id IS NOT NULL)
      AND run_id NOT IN(SELECT substr(key,7,36) FROM app_state WHERE key LIKE 'crawl:%:21run' AND ${jsonField(env.DB, "value", "createdAt")}>=?)`,
      twoDays,
      twoDays,
    ),
    prune("product_checks", "checked_at<?", twoDays),
    prune("price_history", "observed_at<?", ninetyDays),
    prune(
      "digest_jobs",
      "created_at<? AND status IN('sent','suppressed','failed')",
      ninetyDays,
    ),
    prune(
      "source_runs",
      "run_id IN(SELECT id FROM scan_runs WHERE started_at<?) AND run_id NOT IN(SELECT run_id FROM offer_snapshots) AND run_id NOT IN(SELECT run_id FROM digest_jobs)",
      ninetyDays,
    ),
    prune(
      "scan_runs",
      "started_at<? AND id NOT IN(SELECT run_id FROM offer_snapshots) AND id NOT IN(SELECT run_id FROM digest_jobs) AND id NOT IN(SELECT run_id FROM source_runs)",
      ninetyDays,
    ),
    prune("email_confirmations", "expires_at<?", current),
    prune("delivery_budget", "day<?", ninetyDays.slice(0, 10)),
    ...["watch", "feedback"].map((action) =>
      prune(
        "app_state",
        "key LIKE ? AND substr(key,?,13)<?",
        `rate:${action}:%`,
        `rate:${action}:`.length + 64 + 2,
        sevenDays.slice(0, 13),
      ),
    ),
    prune(
      "app_state",
      "key LIKE 'email-confirm:%' AND substr(key,?,13)<?",
      "email-confirm:".length + 64 + 2,
      sevenDays.slice(0, 13),
    ),
    prune(
      "app_state",
      "key LIKE 'confirm:%' AND substr(key,?,10)<?",
      "confirm:".length + 64 + 2,
      sevenDays.slice(0, 10),
    ),
    prune(
      "app_state",
      `key LIKE 'crawl:%' AND ${jsonField(env.DB, "value", "createdAt")}<?`,
      sevenDays,
    ),
    prune("app_state", "key LIKE 'scan-window:%' OR key='scan_lock'"),
    query(
      "INSERT INTO app_state(key,value) VALUES('last_cleanup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      current,
    ),
  ];
  let deleted = 0;
  for (const { sql, args } of queries) {
    const result = (await env.DB.prepare(sql)
      .bind(...args)
      .run()) as { rowsAffected?: number; changes?: number };
    if (sql.startsWith("DELETE"))
      deleted += Number(result?.rowsAffected ?? result?.changes ?? 0);
  }
  return { deleted };
}
