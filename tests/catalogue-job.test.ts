import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {advanceCatalogue} from '../src/catalogue-job';
import {initializeSources} from '../src/scan';
import type {Env,Statement} from '../src/types';
import fixture from '../fixtures/twentyone-product.json';

test('a catalogue resumes from its saved page and publishes only when all pages finish',async()=>{
 const db=new Database(':memory:');db.exec('PRAGMA foreign_keys=ON');
 const journal=await Bun.file('drizzle/meta/_journal.json').json();for(const {tag} of journal.entries)db.exec(await Bun.file(`drizzle/${tag}.sql`).text());
 function statement(sql:string,args:unknown[]=[]):Statement{return {bind:(...v)=>statement(sql,v),first:async<T>()=>(db.query(sql).get(...args as any[])??null) as T|null,all:async<T>()=>({results:db.query(sql).all(...args as any[]) as T[]}),run:async()=>db.query(sql).run(...args as any[])}};
 const env:Env={DB:{prepare:sql=>statement(sql),batch:async statements=>{db.exec('BEGIN');try{for(const s of statements)await s.run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}}};
 const fetch=globalThis.fetch;const run=crypto.randomUUID(),now=new Date().toISOString(),base='https://21run.com/eu/sale/running-shoes';
 const entry=JSON.stringify({sku:fixture.parent.sku,url:fixture.parent.product_url,price:159.95,special_price:119.95}).replaceAll('"','&quot;');
 globalThis.fetch=(async(input:unknown)=>{const url=String(input);if(url.endsWith('/robots.txt'))return new Response('User-agent: *\nDisallow: /*?*=*\nAllow: /*?p=*');if(url.startsWith(base))return new Response(`<div data-product="${entry}"></div>${url===base?`<a class="pages-item-next" href="${base}?p=2">Next</a>`:''}`);if(url.includes('/sizeselector/'))return Response.json(fixture.sizes);if(url.includes('/product-alternative/'))return Response.json(fixture.parent);throw new Error('Unexpected request');}) as typeof globalThis.fetch;
 try{
  await initializeSources(env);await env.DB.prepare("INSERT INTO scan_runs(id,slot_key,status,started_at,heartbeat_at) VALUES(?,?,'complete',?,?)").bind(run,run,now,now).run();
  expect((await advanceCatalogue(env,run)).done).toBe(false);
  expect((await env.DB.prepare("SELECT live_snapshot_id FROM sources WHERE id='21run'").first<{live_snapshot_id:string|null}>())!.live_snapshot_id).toBeNull();
  expect((await advanceCatalogue(env,run)).status).toBe('complete');
  const source=await env.DB.prepare("SELECT status,product_count,live_snapshot_id FROM sources WHERE id='21run'").first<{status:string;product_count:number;live_snapshot_id:string}>();
  expect(source).toMatchObject({status:'live',product_count:1,live_snapshot_id:`${run}:21run:full`});
  expect((await env.DB.prepare("SELECT count(*) n FROM offer_snapshots WHERE source_id='21run'").first<{n:number}>())!.n).toBe(2);
  expect((await advanceCatalogue(env,run)).done).toBe(true);
 }finally{globalThis.fetch=fetch;db.close();}
},15000);
