import type { Env } from './types';
import { releaseUnsentRecommendations } from './recommendations';
export async function cleanup(env:Env,now=new Date()) {
 const current=now.toISOString(),twoDays=new Date(+now-2*86400000).toISOString(),sevenDays=new Date(+now-7*86400000).toISOString(),ninetyDays=new Date(+now-90*86400000).toISOString();
 const expired=(await env.DB.prepare("SELECT id FROM digest_jobs WHERE status IN('queued','sending') AND created_at<?").bind(new Date(+now-6*3600000).toISOString()).all<{id:string}>()).results;
 for(const job of expired)await releaseUnsentRecommendations(env,job.id);
 // Compact recommendation receipts intentionally outlive 90-day delivery logs.
 await env.DB.batch([
  env.DB.prepare("UPDATE digest_jobs SET status='suppressed',error='Scan expired',payload=NULL,candidates='[]' WHERE status IN('queued','sending') AND created_at<?").bind(new Date(+now-6*3600000).toISOString()),
  env.DB.prepare("UPDATE digest_jobs SET payload=NULL,candidates='[]' WHERE status IN('sent','suppressed','failed') AND created_at<?").bind(twoDays),
  env.DB.prepare('DELETE FROM notifications WHERE created_at<?').bind(ninetyDays),
  // A permanently unavailable shop must not pin an old catalogue forever.
  env.DB.prepare('UPDATE sources SET live_snapshot_id=NULL WHERE live_snapshot_id IS NOT NULL AND (last_success IS NULL OR last_success<?)').bind(twoDays),
  // The pre-snapshot table is only a migration fallback. Once a source has moved
  // to snapshots, or its legacy observations expire, those rows are obsolete.
  env.DB.prepare('DELETE FROM offers WHERE source_id IN(SELECT id FROM sources WHERE live_snapshot_id IS NOT NULL) OR checked_at<?').bind(twoDays),
  env.DB.prepare('DELETE FROM offer_snapshots WHERE checked_at<? AND snapshot_id NOT IN(SELECT live_snapshot_id FROM sources WHERE live_snapshot_id IS NOT NULL)').bind(twoDays),
  env.DB.prepare('DELETE FROM product_checks WHERE checked_at<?').bind(twoDays),
  env.DB.prepare('DELETE FROM price_history WHERE observed_at<?').bind(ninetyDays),
  env.DB.prepare("DELETE FROM digest_jobs WHERE created_at<? AND status IN('sent','suppressed','failed')").bind(ninetyDays),
  env.DB.prepare('DELETE FROM source_runs WHERE run_id IN(SELECT id FROM scan_runs WHERE started_at<?) AND run_id NOT IN(SELECT run_id FROM offer_snapshots) AND run_id NOT IN(SELECT run_id FROM digest_jobs)').bind(ninetyDays),
  env.DB.prepare('DELETE FROM scan_runs WHERE started_at<? AND id NOT IN(SELECT run_id FROM offer_snapshots) AND id NOT IN(SELECT run_id FROM digest_jobs) AND id NOT IN(SELECT run_id FROM source_runs)').bind(ninetyDays),
  env.DB.prepare('DELETE FROM email_confirmations WHERE expires_at<?').bind(current),
  env.DB.prepare('DELETE FROM delivery_budget WHERE day<?').bind(ninetyDays.slice(0,10)),
  ...['watch','feedback'].map(action=>env.DB.prepare('DELETE FROM app_state WHERE key LIKE ? AND substr(key,?,13)<?').bind(`rate:${action}:%`,`rate:${action}:`.length+64+2,sevenDays.slice(0,13))),
  env.DB.prepare("DELETE FROM app_state WHERE key LIKE 'confirm:%' AND substr(key,?,10)<?").bind('confirm:'.length+64+2,sevenDays.slice(0,10)),
  env.DB.prepare("DELETE FROM app_state WHERE key LIKE 'crawl:%' AND json_extract(value,'$.createdAt')<?").bind(sevenDays),
  env.DB.prepare("DELETE FROM app_state WHERE key LIKE 'scan-window:%' OR key='scan_lock'"),
  env.DB.prepare("INSERT INTO app_state(key,value) VALUES('last_cleanup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(current)
 ]);
}
