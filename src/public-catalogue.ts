import type { Env, Offer } from "./types";
import { freshCutoff } from "./types";
import { groupOffers } from "./offer-groups";
import { sources as approved } from "./sources";
import { shopLocation } from "./shops";
import { currentDeals } from "./catalogue";
type Group = ReturnType<typeof groupOffers>[number];
type Source = {
  id: string;
  name: string;
  url: string;
  adapter: string;
  status: string;
  last_attempt: string | null;
  last_success: string | null;
  product_count: number;
  live_snapshot_id?: string | null;
  error: string | null;
  inventory?: unknown;
};
const key = (id: string) => `public:shop:${id}`;
export const saleOffers = (offers: Offer[]) =>
  offers.filter(
    (o) =>
      o.available === 1 &&
      o.reference_price !== null &&
      o.price * 100 <= o.reference_price * 80,
  );
export function publicSourceStatement(
  env: Env,
  source: Source,
  offers: Offer[],
) {
  const products: Record<string, Group[]> = {};
  for (const offer of groupOffers(saleOffers(offers)))
    (products[offer.product_id] ??= []).push(offer);
  return env.DB.prepare(
    "INSERT INTO app_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).bind(key(source.id), JSON.stringify({ source, products }));
}
// A single indexed read of compact, pre-grouped public facts. No size-table
// scans, per-visitor joins, member records or dynamic JSON aggregation.
export async function readPublicCatalogue(env: Env) {
  const rows = (
    await env.DB.prepare(
      "SELECT key,value FROM app_state WHERE key>='public:' AND key<'public;'",
    ).all<{ key: string; value: string }>()
  ).results;
  const records = new Map(rows.map((r) => [r.key, JSON.parse(r.value)]));
  const cutoff = freshCutoff();
  const offers: Group[] = [],
    sources = [];
  for (const config of approved) {
    const record = records.get(key(config.id));
    let source: Source = record?.source ?? {
      id: config.id,
      name: config.name,
      url: config.url,
      adapter: config.adapter,
      status: "planned",
      last_attempt: null,
      last_success: null,
      product_count: 0,
      error: "No published catalogue yet",
    };
    source = {
      ...source,
      name: config.name,
      url: config.url,
      adapter: config.adapter,
    };
    const groups: Group[] =
      record && ["live", "partial", "cached"].includes(source.status)
        ? (Object.values(record.products).flat() as Group[]).filter(
            (o) =>
              o.available === 1 &&
              o.checked_at >= cutoff &&
              o.reference_price !== null &&
              o.price * 100 <= o.reference_price * 80,
          )
        : [];
    offers.push(...groups);
    sources.push({
      ...source,
      current_deals: new Set(groups.map((o) => o.product_id)).size,
      ...shopLocation(source.id),
    });
  }
  const state: { lastScan: string | null; pipeline: unknown } = records.get(
    "public:state",
  ) ?? {
    lastScan: null,
    pipeline: null,
  };
  return {
    ...state,
    offers: offers.sort((a, b) => b.discount - a.discount || a.price - b.price),
    sources,
  };
}
// Product checks replace just that product atomically, so concurrent checks
// cannot overwrite each other or leave known bad stock in the public snapshot.
export function publicProductStatement(
  env: Env,
  sourceId: string,
  productId: string,
  offers: Offer[],
) {
  return patchPublic(env, sourceId, [
    [["products", productId], groupOffers(saleOffers(offers))],
  ]);
}
export function publicFailureStatement(
  env: Env,
  sourceId: string,
  error: string,
  at: string,
  retainPublished = false,
) {
  return patchPublic(env, sourceId, [
    [["source", "status"], retainPublished ? "cached" : "error"],
    [["source", "error"], error],
    [["source", "last_attempt"], at],
  ]);
}
// Browsing may retain an unchanged, already published snapshot after a
// transport failure. Email queries still exclude the failed source in SQL.
export async function canRetainPublished(env:Env,sourceId:string){
  const row=await env.DB.prepare("SELECT s.id FROM sources s WHERE s.id=? AND s.live_snapshot_id IS NOT NULL AND s.last_success>=? AND EXISTS(SELECT 1 FROM app_state a WHERE a.key=?) AND NOT EXISTS(SELECT 1 FROM app_state p WHERE p.key=?)").bind(sourceId,freshCutoff(),key(sourceId),`ops:source-pause:${sourceId}`).first();
  return !!row;
}
export function publicStateStatement(
  env: Env,
  lastScan: string | null,
  pipeline: unknown,
) {
  return env.DB.prepare(
    "INSERT INTO app_state(key,value) VALUES('public:state',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",
  ).bind(JSON.stringify({ lastScan, pipeline }));
}
// Explicit bootstrap/rebuild from existing published data; never invoked by a
// visitor. Future publications update their own source in the same transaction.
export async function rebuildPublicCatalogue(env: Env) {
  const sources = (await env.DB.prepare("SELECT * FROM sources").all<Source>())
    .results;
  const offers = await currentDeals(
    env,
    -1,
    sources.map((s) => ({
      ...s,
      live_snapshot_id: s.live_snapshot_id ?? null,
    })),
  );
  const last =
    (
      await env.DB.prepare(
        "SELECT value FROM app_state WHERE key='last_scan'",
      ).first<{ value: string }>()
    )?.value ?? null;
  await env.DB.batch([
    ...sources.map((s) =>
      publicSourceStatement(
        env,
        s,
        offers.filter((o) => o.source_id === s.id),
      ),
    ),
    publicStateStatement(env, last, null),
  ]);
  return { sources: sources.length, variants: offers.length };
}

export function publicProgressStatement(
  env: Env,
  sourceId: string,
  message: string,
  at: string,
) {
  return patchPublic(env, sourceId, [
    [["source", "error"], message],
    [["source", "last_attempt"], at],
  ]);
}

function patchPublic(
  env: Env,
  sourceId: string,
  updates: [string[], unknown][],
) {
  const args: unknown[] = [];
  let expression = "value";
  for (const [path, value] of updates) {
    if (env.DB.dialect === "postgres") {
      expression = `jsonb_set((${expression})::jsonb,ARRAY(SELECT jsonb_array_elements_text(?::jsonb)),?::jsonb)`;
      args.push(JSON.stringify(path), JSON.stringify(value));
    } else {
      expression = `json_set(${expression},?,json(?))`;
      args.push(
        "$." + path.map((p) => JSON.stringify(p)).join("."),
        JSON.stringify(value),
      );
    }
  }
  return env.DB.prepare(
    `UPDATE app_state SET value=(${expression})${env.DB.dialect === "postgres" ? "::text" : ""} WHERE key=?`,
  ).bind(...args, key(sourceId));
}
