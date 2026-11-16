import type { Env, Watch } from "./types";
const watchFields =
  "id,kind,query,category,fit,size_system,size,colour,budget,min_discount,active,email_verified,created_at";
// Keep private metadata in one indexed SQL request, bound to this device. No
// address, owner capability, confirmation or unsubscribe token is returned.
export async function dashboardState(env: Env, owner: string) {
  const pg = env.DB.dialect === "postgres";
  const object = pg ? "jsonb_build_object" : "json_object";
  const array = pg ? "jsonb_agg" : "json_group_array";
  const text = pg ? "::text" : "";
  const row = await env.DB.prepare(
    `SELECT
  (SELECT value FROM app_state WHERE key='last_scan') AS last_scan,
  (SELECT ${object}('id',id,'status',status,'started_at',started_at,'completed_at',completed_at) ${text} FROM scan_runs ORDER BY started_at DESC LIMIT 1) AS pipeline,
  (SELECT ${array}(${object}(${watchFields
    .split(",")
    .map((k) => `'${k}',w.${k}`)
    .join(",")}))${text} FROM
    (SELECT ${watchFields} FROM watches WHERE owner_id=? ORDER BY created_at DESC) w) AS watches,
  (SELECT ${array}(${object}('watch_id',watch_id,'status',status))${text} FROM
    (SELECT min(w.id) watch_id,coalesce(i.delivery_state,'not_sent') status FROM watches w
     LEFT JOIN email_identities i ON i.owner_id=w.owner_id AND i.email=w.email
     WHERE w.owner_id=? AND w.email_verified=0 AND w.active=1 GROUP BY w.email,i.delivery_state)) AS verifications`,
  )
    .bind(owner, owner)
    .first<{
      last_scan: string | null;
      pipeline: string | null;
      watches: string;
      verifications: string;
    }>();
  if (!row) throw new Error("Dashboard state unavailable");
  return {
    lastScan: row.last_scan,
    pipeline: JSON.parse(row.pipeline ?? "null"),
    watches: JSON.parse(row.watches ?? "[]") as Watch[],
    verifications: JSON.parse(row.verifications ?? "[]"),
  };
}
