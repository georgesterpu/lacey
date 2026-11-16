import type { Env, Offer, Watch } from "./types";
import { freshCutoff, matches } from "./types";
import { shoeIdentity } from "./shoe-identity";
import { planDigests } from "./outbox";
import { validateProduct } from "./validation";
// Retailer traffic belongs to the trusted collection worker. Vercel reads the
// same short-lived verification cache before sending; it never receives a
// collector credential from the browser or exposes recipient data to a shop.
export async function prepareDelivery(env: Env, runId: string) {
  const plan = await planDigests(env, runId);
  if (plan.error) return { checked: 0, blocked: 0, plan };
  const job = await env.DB.prepare(
    "SELECT id,email_hash,candidates,payload FROM digest_jobs WHERE run_id=? AND status='queued' AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY created_at,id LIMIT 1",
  )
    .bind(runId, new Date().toISOString())
    .first<{
      id: string;
      email_hash: string;
      candidates: string;
      payload: string | null;
    }>();
  if (!job) return { checked: 0, blocked: 0, plan };
  const products = new Map<string, Offer>();
  const watches = new Map(
    (
      await env.DB.prepare(
        "SELECT w.* FROM watches w JOIN subscribers s ON s.email=w.email WHERE s.email_hash=? AND s.unsubscribed=0 AND w.active=1 AND w.email_verified=1 LIMIT 100",
      )
        .bind(job.email_hash)
        .all<Watch>()
    ).results.map((w) => [w.id, w]),
  );
  const receipts = new Set(
    (
      await env.DB.prepare(
        "SELECT shoe_key FROM recommendation_receipts WHERE email_hash=? AND (status='sent' OR job_id IS NULL OR job_id!=?)",
      )
        .bind(job.email_hash, job.id)
        .all<{ shoe_key: string }>()
    ).results.map((r) => r.shoe_key),
  );
  const frozen = job.payload
    ? new Set<string>(JSON.parse(job.payload).ids)
    : null;
  for (const candidate of JSON.parse(job.candidates) as {
    offerId: string;
    price: number;
    watchId: string;
    watchIds?: string[];
  }[]) {
    if (frozen && !frozen.has(`${candidate.offerId}:${candidate.price}`))
      continue;
    const offer = await env.DB.prepare(
      "SELECT o.* FROM offer_snapshots o JOIN sources s ON s.id=o.source_id AND s.live_snapshot_id=o.snapshot_id WHERE o.id=? AND o.checked_at>=? AND s.status IN('live','partial')",
    )
      .bind(candidate.offerId, freshCutoff())
      .first<Offer>();
    if (
      offer &&
      offer.price === candidate.price &&
      !receipts.has(shoeIdentity(offer).key) &&
      (candidate.watchIds ?? [candidate.watchId]).some((id) => {
        const w = watches.get(id);
        return w && matches(w, offer);
      })
    )
      products.set(`${offer.source_id}:${offer.product_id}`, offer);
    if (products.size >= 24) break;
  }
  let blocked = 0;
  const offers = [...products.values()];
  for (let i = 0; i < offers.length; i += 4)
    await Promise.all(
      offers.slice(i, i + 4).map(async (offer) => {
        if (
          !(await validateProduct(env, runId, offer)).some((v) => v.available)
        )
          blocked++;
      }),
    );
  return { checked: offers.length, blocked, plan };
}
