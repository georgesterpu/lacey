import { jsonField } from "./sql-json";
import {
  publicSourceStatement,
  publicFailureStatement,
  publicProgressStatement,
  saleOffers,
} from "./public-catalogue";
import { currentDeals } from "./catalogue";
import type { Env } from "./types";
import {
  twentyOneStep,
  RetryableRequestError,
  type CrawlCursor,
} from "./twentyone";
import { retailerStep, pagedRetailers } from "./retailer-crawl";
import { RetailerRequestError } from "./retailer-http";
import { sources } from "./sources";
import { offerStatements, inventorySummary } from "./snapshots";
import { scheduleSlot } from "./schedule";

// Every paged shop shares leases, retries, checkpoints and atomic publication.
// Only listing/product decoding differs. No product limits or shoe names.
export async function advanceCatalogue(
  env: Env,
  runId: string,
  sourceId = "21run",
) {
  const source = sources.find(
    (s) => s.id === sourceId && ["twentyone", "catalogue"].includes(s.adapter),
  );
  if (!source) throw new Error("Unknown catalogue source");
  const operatorPause=await env.DB.prepare('SELECT value FROM app_state WHERE key=?').bind(`ops:source-pause:${sourceId}`).first<{value:string}>();
  if(operatorPause)return {done:true,status:'paused',operatorPaused:true,error:operatorPause.value};
  if (
    !(await env.DB.prepare("SELECT id FROM scan_runs WHERE id=?")
      .bind(runId)
      .first())
  )
    throw new Error("Unknown scan");
  const blocked = await env.DB.prepare(
    "SELECT error,last_attempt,last_success FROM sources WHERE id=?",
  )
    .bind(sourceId)
    .first<{
      error: string | null;
      last_attempt: string | null;
      last_success: string | null;
    }>();
  const resumeAt = blocked?.last_attempt
    ? Date.parse(blocked.last_attempt) + 12 * 3600000
    : 0;
  if (blocked?.error?.includes("paused:") && resumeAt > Date.now())
    return {
      done: true,
      status: "paused",
      retryAfterMs: resumeAt - Date.now(),
      error: blocked.error,
    };
  const active = await env.DB.prepare(
    `SELECT key FROM app_state WHERE key LIKE ? AND ${jsonField(env.DB, "value", "createdAt")}>? ORDER BY ${jsonField(env.DB, "value", "createdAt")} LIMIT 1`,
  )
    .bind(
      `crawl:%:${sourceId}`,
      new Date(
        Math.max(
          Date.now() - 24 * 3600000,
          Date.parse(blocked?.last_success ?? "") || 0,
        ),
      ).toISOString(),
    )
    .first<{ key: string }>();
  if (active) runId = active.key.split(":")[1];
  else {
    if (
      blocked?.last_success &&
      scheduleSlot(new Date(blocked.last_success)) === scheduleSlot()
    )
      return { done: true, status: "complete", skipped: true };
  }
  const now = new Date().toISOString(),
    key = `crawl:${runId}:${sourceId}`,
    retryKey = `${key}:retry`,
    lease = crypto.randomUUID();
  let snapshot = `${runId}:${sourceId}:full`;
  await env.DB.prepare(
    "INSERT INTO source_runs(run_id,source_id,status) VALUES(?,?,'pending') ON CONFLICT DO NOTHING",
  )
    .bind(runId, sourceId)
    .run();
  let job = await env.DB.prepare(
    "SELECT status,details,completed_at FROM source_runs WHERE run_id=? AND source_id=?",
  )
    .bind(runId, sourceId)
    .first<{
      status: string;
      details: string | null;
      completed_at: string | null;
    }>();
  if (job?.status === "complete") return { done: true, status: "complete" };
  if (job?.status === "failed") {
    const saved = await env.DB.prepare(
        "SELECT value FROM app_state WHERE key=?",
      )
        .bind(retryKey)
        .first<{ value: string }>(),
      retry = saved
        ? (JSON.parse(saved.value) as { attempts: number; after: number })
        : null;
    const cooldownEnded =
      job.details?.includes("paused:") &&
      job.completed_at &&
      Date.parse(job.completed_at) < Date.now() - 12 * 3600000;
    if (
      (!retry &&
        job.details !== "21RUN product identity mismatch" &&
        !cooldownEnded) ||
      (retry && retry.attempts >= 3)
    )
      return { done: true, status: "failed", error: job.details };
    if (retry && retry.after > Date.now())
      return {
        done: false,
        status: "retrying",
        retryAfterMs: retry.after - Date.now(),
        error: job.details,
      };
    await env.DB.prepare(
      "UPDATE source_runs SET status='pending' WHERE run_id=? AND source_id=? AND status='failed'",
    )
      .bind(runId, sourceId)
      .run();
  }
  if (job?.status === "partial")
    await env.DB.prepare(
      "UPDATE source_runs SET status='pending' WHERE run_id=? AND source_id=?",
    )
      .bind(runId, sourceId)
      .run();
  await env.DB.prepare(
    "UPDATE source_runs SET status='collecting',details=?,completed_at=? WHERE run_id=? AND source_id=? AND (status='pending' OR (status='collecting' AND completed_at<?))",
  )
    .bind(
      lease,
      new Date(Date.now() + 180000).toISOString(),
      runId,
      sourceId,
      now,
    )
    .run();
  job = await env.DB.prepare(
    "SELECT status,details,completed_at FROM source_runs WHERE run_id=? AND source_id=?",
  )
    .bind(runId, sourceId)
    .first();
  if (job?.details !== lease) return { done: false, status: "busy" };
  try {
    const pause = await env.DB.prepare(
      "SELECT error,last_attempt FROM sources WHERE id=?",
    )
      .bind(sourceId)
      .first<{ error: string | null; last_attempt: string | null }>();
    if (
      pause?.error?.includes("paused:") &&
      pause.last_attempt &&
      Date.parse(pause.last_attempt) > Date.now() - 12 * 3600000
    )
      throw new Error(pause.error);
    const saved = await env.DB.prepare(
        "SELECT value FROM app_state WHERE key=?",
      )
        .bind(key)
        .first<{ value: string }>(),
      cursor = saved ? (JSON.parse(saved.value) as CrawlCursor) : null;
    if (sourceId !== "21run")
      snapshot =
        cursor?.snapshot ??
        (cursor ? snapshot : `${snapshot}:${crypto.randomUUID()}`);
    let inventory = cursor?.inventory;
    if (!inventory) {
      const baseline = await env.DB.prepare(
        'SELECT count(*) variants,count(DISTINCT product_id) products,count(DISTINCT CASE WHEN available=1 THEN product_id END) AS "availableProducts" FROM offer_snapshots WHERE snapshot_id=?',
      )
        .bind(snapshot)
        .first<{
          variants: number;
          products: number;
          availableProducts: number;
        }>();
      inventory = {
        products: baseline?.products ?? 0,
        variants: baseline?.variants ?? 0,
        availableProducts: baseline?.availableProducts ?? 0,
        soldOutProducts:
          (baseline?.products ?? 0) - (baseline?.availableProducts ?? 0),
      };
    }
    const result =
      sourceId === "21run"
        ? await twentyOneStep(cursor, now)
        : await retailerStep(
            sourceId as keyof typeof pagedRetailers,
            cursor,
            now,
          );
    result.cursor.snapshot = snapshot;
    const observed = inventorySummary(result.offers);
    result.cursor.inventory = {
      products: inventory.products + observed.products,
      variants: inventory.variants + observed.variants,
      availableProducts:
        inventory.availableProducts + observed.availableProducts,
      soldOutProducts: inventory.soldOutProducts + observed.soldOutProducts,
    };
    const rejected = result.cursor.rejected ?? 0,
      progress = `${result.cursor.pages} pages · ${result.cursor.products} products checked · ${rejected} quarantined`;
    await env.DB.batch([
      publicProgressStatement(
        env,
        sourceId,
        `Updating catalogue: ${progress}`,
        now,
      ),
      ...offerStatements(env, runId, saleOffers(result.offers), snapshot),
      env.DB.prepare(
        "INSERT INTO app_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
      ).bind(key, JSON.stringify(result.cursor)),
      env.DB.prepare(
        "UPDATE source_runs SET status='pending',details=?,rejected=?,completed_at=NULL WHERE run_id=? AND source_id=?",
      ).bind(progress, rejected, runId, sourceId),
      env.DB.prepare("DELETE FROM app_state WHERE key=?").bind(retryKey),
      env.DB.prepare(
        "UPDATE sources SET last_attempt=?,error=? WHERE id=?",
      ).bind(now, `Updating catalogue: ${progress}`, sourceId),
    ]);
    if (result.done) {
      const audit = result.cursor.inventory,
        previous = await env.DB.prepare(
          "SELECT product_count FROM sources WHERE id=?",
        )
          .bind(sourceId)
          .first<{ product_count: number }>();
      if (
        !audit.products ||
        ((previous?.product_count ?? 0) > 50 &&
          audit.products < previous!.product_count * 0.5)
      )
        throw new Error(
          `${source.name} catalogue unexpectedly empty or shrank by over 50%; snapshot withheld`,
        );
      const visible = await currentDeals(env, -1, [
        { id: sourceId, status: "live", live_snapshot_id: snapshot },
      ]);
      await env.DB.batch([
        publicSourceStatement(
          env,
          {
            id: sourceId,
            name: source.name,
            url: source.url,
            adapter: source.adapter,
            status: rejected ? "partial" : "live",
            last_attempt: now,
            last_success: now,
            product_count: audit.products,
            live_snapshot_id: snapshot,
            error: rejected
              ? `${rejected} conflicting products withheld`
              : null,
            inventory: { snapshot, checkedAt: now, ...audit },
          },
          visible,
        ),
        env.DB.prepare(
          "INSERT INTO app_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
        ).bind(
          `source-summary:${sourceId}`,
          JSON.stringify({ snapshot, checkedAt: now, ...audit }),
        ),
        env.DB.prepare(
          "UPDATE sources SET live_snapshot_id=?,status=?,product_count=?,last_success=?,error=? WHERE id=?",
        ).bind(
          snapshot,
          rejected ? "partial" : "live",
          audit.products,
          now,
          rejected
            ? `${rejected} conflicting products withheld; remaining catalogue verified`
            : null,
          sourceId,
        ),
        env.DB.prepare(
          "UPDATE source_runs SET status='complete',products=?,variants=?,details=?,completed_at=? WHERE run_id=? AND source_id=?",
        ).bind(
          audit.products,
          audit.variants,
          `${progress}${rejected ? `; examples: ${JSON.stringify(result.cursor.issues)}` : ""}`,
          now,
          runId,
          sourceId,
        ),
        env.DB.prepare("DELETE FROM app_state WHERE key=?").bind(key),
      ]);
    }
    return {
      done: result.done,
      status: result.done ? "complete" : "collecting",
      pages: result.cursor.pages,
      checked: result.cursor.products,
      variants: result.offers.length,
      rejected,
    };
  } catch (error) {
    const message = (error as Error).message.slice(0, 350);
    let retry:
      { attempts: number; after: number; createdAt: string } | undefined;
    if (
      error instanceof RetryableRequestError ||
      (error instanceof RetailerRequestError && error.retryable) ||
      ["TimeoutError", "AbortError"].includes((error as Error).name)
    ) {
      const saved = await env.DB.prepare(
          "SELECT value FROM app_state WHERE key=?",
        )
          .bind(retryKey)
          .first<{ value: string }>(),
        attempts = (saved ? Number(JSON.parse(saved.value).attempts) : 0) + 1;
      retry = {
        attempts,
        after: Date.now() + attempts * 15000,
        createdAt: now,
      };
    }
    await env.DB.batch([
      publicFailureStatement(env, sourceId, message, now),
      retry
        ? env.DB.prepare(
            "INSERT INTO app_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
          ).bind(retryKey, JSON.stringify(retry))
        : env.DB.prepare("DELETE FROM app_state WHERE key=?").bind(retryKey),
      env.DB.prepare(
        "UPDATE source_runs SET status='failed',details=?,completed_at=? WHERE run_id=? AND source_id=?",
      ).bind(message, now, runId, sourceId),
      env.DB.prepare(
        "UPDATE sources SET status='error',error=?,last_attempt=? WHERE id=?",
      ).bind(message, now, sourceId),
    ]);
    return retry && retry.attempts < 3
      ? {
          done: false,
          status: "retrying",
          retryAfterMs: retry.after - Date.now(),
          error: message,
        }
      : { done: true, status: "failed", error: message };
  }
}
