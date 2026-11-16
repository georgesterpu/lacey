import {publicSourceStatement,publicFailureStatement,publicProgressStatement} from './public-catalogue';
import {currentDeals} from './catalogue';
import type { Env } from './types';
import { twentyOneStep, RetryableRequestError, type CrawlCursor } from './twentyone';
import { offerStatements } from './snapshots';
import { scheduleSlot } from './schedule';

// A persistent cursor replaces arbitrary product limits and long HTTP requests.
// A failed invocation leaves the last checkpoint intact. Only a finished crawl
// replaces the public snapshot, so half a catalogue is never presented as complete.
export async function advanceCatalogue(env: Env, runId: string) {
  const run = await env.DB.prepare('SELECT id FROM scan_runs WHERE id=?')
    .bind(runId)
    .first();
  if (!run) throw new Error('Unknown scan');
  // A new email slot must not discard an unfinished catalogue. Reuse its scan
  // namespace until publication; delivery reads fresh, published snapshots.
  const active = await env.DB.prepare(
    "SELECT key FROM app_state WHERE key LIKE 'crawl:%:21run' AND json_extract(value,'$.createdAt')>? ORDER BY json_extract(value,'$.createdAt') LIMIT 1",
  ).bind(new Date(Date.now() - 24 * 3600000).toISOString()).first<{ key: string }>();
  if (active) runId = active.key.split(':')[1];
  else {
    const source = await env.DB.prepare("SELECT last_success FROM sources WHERE id='21run'")
      .first<{ last_success: string | null }>();
    if (source?.last_success && scheduleSlot(new Date(source.last_success)) === scheduleSlot())
      return { done: true, status: 'complete', skipped: true };
  }
  const now = new Date().toISOString(),
    key = `crawl:${runId}:21run`,
    retryKey = `${key}:retry`,
    lease = crypto.randomUUID();
  await env.DB.prepare(
    "INSERT INTO source_runs(run_id,source_id,status) VALUES(?,'21run','pending') ON CONFLICT DO NOTHING",
  )
    .bind(runId)
    .run();
  let job = await env.DB.prepare(
    "SELECT status,details,completed_at FROM source_runs WHERE run_id=? AND source_id='21run'",
  )
    .bind(runId)
    .first<{
      status: string;
      details: string | null;
      completed_at: string | null;
    }>();
  if (job?.status === 'partial') {
    await env.DB.prepare(
      "UPDATE source_runs SET status='pending' WHERE run_id=? AND source_id='21run'",
    )
      .bind(runId)
      .run();
  }
  if (job?.status === 'complete') return { done: true, status: 'complete' };
  if (job?.status === 'failed') {
    const savedRetry = await env.DB.prepare('SELECT value FROM app_state WHERE key=?')
      .bind(retryKey).first<{ value: string }>();
    const retry = savedRetry ? JSON.parse(savedRetry.value) as { attempts: number; after: number } : null;
    // Recover checkpoints stranded by the old all-or-nothing product validator.
    // Other permanent failures (including retailer blocks) require investigation.
    if ((!retry && job.details !== '21RUN product identity mismatch') || (retry && retry.attempts >= 3))
      return { done: true, status: 'failed', error: job.details };
    if (retry && retry.after > Date.now())
      return { done: false, status: 'retrying', retryAfterMs: retry.after - Date.now(), error: job.details };
    await env.DB.prepare("UPDATE source_runs SET status='pending' WHERE run_id=? AND source_id='21run' AND status='failed'")
      .bind(runId).run();
  }
  await env.DB.prepare(
    `UPDATE source_runs SET status='collecting',details=?,completed_at=? WHERE run_id=? AND source_id='21run'
  AND (status='pending' OR (status='collecting' AND completed_at<?))`,
  )
    .bind(lease, new Date(Date.now() + 180000).toISOString(), runId, now)
    .run();
  job = await env.DB.prepare(
    "SELECT status,details,completed_at FROM source_runs WHERE run_id=? AND source_id='21run'",
  )
    .bind(runId)
    .first();
  if (job?.details !== lease) return { done: false, status: 'busy' };
  try {
    const pause = await env.DB.prepare(
      "SELECT error,last_attempt FROM sources WHERE id='21run'",
    ).first<{ error: string | null; last_attempt: string | null }>();
    if (
      pause?.error?.includes('21RUN paused') &&
      pause.last_attempt &&
      Date.parse(pause.last_attempt) > Date.now() - 12 * 3600000
    )
      throw new Error(pause.error);
    const saved = await env.DB.prepare(
      'SELECT value FROM app_state WHERE key=?',
    )
      .bind(key)
      .first<{ value: string }>();
    const result = await twentyOneStep(
      saved ? (JSON.parse(saved.value) as CrawlCursor) : null,
      now,
    );
    const rejected = result.cursor.rejected ?? 0;
    const progress = `${result.cursor.pages} pages · ${result.cursor.products} products checked · ${rejected} quarantined`;
    await env.DB.batch([
      publicProgressStatement(env,'21run',`Updating catalogue: ${progress}`,now),
      ...offerStatements(env, runId, result.offers, `${runId}:21run:full`),
      env.DB.prepare(
        'INSERT INTO app_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value',
      ).bind(key, JSON.stringify(result.cursor)),
      env.DB.prepare(
        "UPDATE source_runs SET status='pending',details=?,rejected=?,completed_at=NULL WHERE run_id=? AND source_id='21run'",
      ).bind(progress, rejected, runId),
      env.DB.prepare('DELETE FROM app_state WHERE key=?').bind(retryKey),
      env.DB.prepare(
        "UPDATE sources SET last_attempt=?,error=? WHERE id='21run'",
      ).bind(now, `Updating catalogue: ${progress}`),
    ]);
    if (result.done) {
      const snapshot = `${runId}:21run:full`;
      const totals = await env.DB.prepare(
        'SELECT count(*) variants,count(DISTINCT product_id) products,count(DISTINCT CASE WHEN available=1 THEN product_id END) availableProducts FROM offer_snapshots WHERE snapshot_id=?',
      )
        .bind(snapshot)
        .first<{ variants: number; products: number; availableProducts:number }>();
      const previous = await env.DB.prepare(
        "SELECT product_count FROM sources WHERE id='21run'",
      ).first<{ product_count: number }>();
      if (
        !totals?.products ||
        ((previous?.product_count ?? 0) > 50 &&
          totals.products < previous!.product_count * 0.5)
      )
        throw new Error(
          '21RUN catalogue unexpectedly empty or shrank by over 50%; snapshot withheld',
        );
      const visible=await currentDeals(env,-1,[{id:'21run',status:'live',live_snapshot_id:snapshot}]);
      await env.DB.batch([
        publicSourceStatement(env,{id:'21run',name:'21RUN',url:'https://21run.com/eu/',adapter:'twentyone',status:rejected?'partial':'live',last_attempt:now,last_success:now,product_count:totals.products,live_snapshot_id:snapshot,error:rejected?`${rejected} conflicting products withheld`:null,inventory:{snapshot,checkedAt:now,...totals,soldOutProducts:totals.products-totals.availableProducts}},visible),
        env.DB.prepare('INSERT INTO app_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value').bind('source-summary:21run',JSON.stringify({snapshot,checkedAt:now,...totals,soldOutProducts:totals.products-totals.availableProducts})),
        env.DB.prepare(
          "UPDATE sources SET live_snapshot_id=?,status=?,product_count=?,last_success=?,error=? WHERE id='21run'",
        ).bind(snapshot, rejected ? 'partial' : 'live', totals.products, now,
          rejected ? `${rejected} conflicting products withheld; remaining catalogue verified` : null),
        env.DB.prepare(
          "UPDATE source_runs SET status='complete',products=?,variants=?,details=?,completed_at=? WHERE run_id=? AND source_id='21run'",
        ).bind(totals.products, totals.variants,
          `${progress}${rejected ? `; examples: ${JSON.stringify(result.cursor.issues)}` : ''}`, now, runId),
        env.DB.prepare('DELETE FROM app_state WHERE key=?').bind(key),
      ]);
    }
    return {
      done: result.done,
      status: result.done ? 'complete' : 'collecting',
      pages: result.cursor.pages,
      checked: result.cursor.products,
      variants: result.offers.length,
      rejected,
    };
  } catch (error) {
    const message = (error as Error).message.slice(0, 350);
    let retry: { attempts: number; after: number; createdAt: string } | undefined;
    if (error instanceof RetryableRequestError || ['TimeoutError','AbortError'].includes((error as Error).name)) {
      const saved = await env.DB.prepare('SELECT value FROM app_state WHERE key=?')
        .bind(retryKey).first<{ value: string }>();
      const attempts = (saved ? Number(JSON.parse(saved.value).attempts) : 0) + 1;
      retry = { attempts, after: Date.now() + attempts * 15000, createdAt: now };
    }
    await env.DB.batch([
      publicFailureStatement(env,'21run',message,now),
      ...(retry ? [env.DB.prepare('INSERT INTO app_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value')
        .bind(retryKey, JSON.stringify(retry))] :
        [env.DB.prepare('DELETE FROM app_state WHERE key=?').bind(retryKey)]),
      env.DB.prepare(
        "UPDATE source_runs SET status='failed',details=?,completed_at=? WHERE run_id=? AND source_id='21run'",
      ).bind(message, now, runId),
      env.DB.prepare(
        "UPDATE sources SET status='error',error=?,last_attempt=? WHERE id='21run'",
      ).bind(message, now),
    ]);
    return retry && retry.attempts < 3
      ? { done: false, status: 'retrying', retryAfterMs: retry.after - Date.now(), error: message }
      : { done: true, status: 'failed', error: message };
  }
}
