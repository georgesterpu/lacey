import {test,expect} from 'bun:test';
import {Database} from 'bun:sqlite';
import {advanceCatalogue} from '../src/catalogue-job';
import {initializeSources} from '../src/scan';
import type {Env,Statement} from '../src/types';
import fixture from '../fixtures/twentyone-product.json';

const base='https://21run.com/eu/sale/running-shoes';
async function scenario(work:(env:Env,run:string,db:Database)=>Promise<void>,response?:(url:string)=>Response|null){
 const db=new Database(':memory:');db.exec('PRAGMA foreign_keys=ON');
 const journal=await Bun.file('drizzle/meta/_journal.json').json();for(const {tag} of journal.entries)db.exec(await Bun.file(`drizzle/${tag}.sql`).text());
 function statement(sql:string,args:unknown[]=[]):Statement{return {bind:(...v)=>statement(sql,v),first:async<T>()=>(db.query(sql).get(...args as any[])??null) as T|null,all:async<T>()=>({results:db.query(sql).all(...args as any[]) as T[]}),run:async()=>db.query(sql).run(...args as any[])}};
 const env:Env={DB:{prepare:sql=>statement(sql),batch:async statements=>{db.exec('BEGIN');try{for(const s of statements)await s.run();db.exec('COMMIT');}catch(e){db.exec('ROLLBACK');throw e;}}}};
 const originalFetch=globalThis.fetch,run=crypto.randomUUID(),now=new Date().toISOString();
 const entry=JSON.stringify({sku:fixture.parent.sku,url:fixture.parent.product_url,price:159.95,special_price:119.95}).replaceAll('"','&quot;');
 globalThis.fetch=(async(input:unknown)=>{
  const url=String(input),override=response?.(url);if(override)return override;
  if(url.endsWith('/robots.txt'))return new Response('User-agent: *\nDisallow: /*?*=*\nAllow: /*?p=*');
  if(url.startsWith(base))return new Response(`<div data-product="${entry}"></div>${url===base?`<a class="pages-item-next" href="${base}?p=2">Next</a>`:''}`);
  if(url.includes('/sizeselector/'))return Response.json(fixture.sizes);
  if(url.includes('/product-alternative/'))return Response.json(fixture.parent);
  throw new Error('Unexpected request');
 }) as typeof globalThis.fetch;
 try{
  await initializeSources(env);
  await env.DB.prepare("INSERT INTO scan_runs(id,slot_key,status,started_at,heartbeat_at) VALUES(?,?,'complete',?,?)").bind(run,run,now,now).run();
  await work(env,run,db);
 }finally{globalThis.fetch=originalFetch;db.close();}
}
async function checkpoint(env:Env,run:string,products=0,bad=false){
 const item={sku:fixture.parent.sku,url:fixture.parent.product_url};
 await env.DB.prepare('INSERT INTO app_state(key,value) VALUES(?,?)').bind(`crawl:${run}:21run`,JSON.stringify({pageUrl:null,queue:bad?[{...item,url:'https://21run.com/eu/wrong-department'},item]:[item],seen:[],pages:67,products,held:0,createdAt:new Date().toISOString()})).run();
}
function expireRetry(db:Database,run:string){db.query("UPDATE app_state SET value=json_set(value,'$.after',0) WHERE key=?").run(`crawl:${run}:21run:retry`);}

test('a catalogue resumes from its saved page and publishes only when all pages finish',async()=>{
 await scenario(async(env,run)=>{
  expect((await advanceCatalogue(env,run)).done).toBe(false);
  expect((await env.DB.prepare("SELECT live_snapshot_id FROM sources WHERE id='21run'").first<{live_snapshot_id:string|null}>())!.live_snapshot_id).toBeNull();
  expect((await advanceCatalogue(env,run)).status).toBe('complete');
  const source=await env.DB.prepare("SELECT status,product_count,live_snapshot_id FROM sources WHERE id='21run'").first();
  expect(source).toMatchObject({status:'live',product_count:1,live_snapshot_id:`${run}:21run:full`});
  expect((await env.DB.prepare("SELECT count(*) n FROM offer_snapshots WHERE source_id='21run'").first<{n:number}>())!.n).toBe(1);
  expect((await advanceCatalogue(env,run)).done).toBe(true);
 });
},15000);

test('the stranded identity-mismatch job resumes, quarantines the conflicting listing and reports it',async()=>{
 await scenario(async(env,run)=>{
  await checkpoint(env,run,20,true);
  await env.DB.prepare("INSERT INTO source_runs(run_id,source_id,status,details) VALUES(?,'21run','failed','21RUN product identity mismatch')").bind(run).run();
  const result=await advanceCatalogue(env,run);
  expect(result).toMatchObject({done:true,status:'complete',checked:22,rejected:1});
  const source=await env.DB.prepare("SELECT status,product_count,live_snapshot_id FROM sources WHERE id='21run'").first();
  expect(source).toMatchObject({status:'partial',product_count:1,live_snapshot_id:`${run}:21run:full`});
  const report=await env.DB.prepare("SELECT rejected,details FROM source_runs WHERE run_id=? AND source_id='21run'").bind(run).first<{rejected:number;details:string}>();
  expect(report!.rejected).toBe(1);
  expect(report!.details).toContain('wrong-department');
  expect((await env.DB.prepare("SELECT count(*) n FROM offer_snapshots WHERE url LIKE '%wrong-department%'").first<{n:number}>())!.n).toBe(0);
 });
},15000);

test('widespread product mismatches still fail closed and leave the published snapshot untouched',async()=>{
 await scenario(async(env,run)=>{
  await checkpoint(env,run,0,true);
  await env.DB.prepare("UPDATE sources SET live_snapshot_id='previous-good-snapshot' WHERE id='21run'").run();
  const result=await advanceCatalogue(env,run);
  expect(result).toMatchObject({done:true,status:'failed'});
  expect(result.error).toContain('over 5%');
  expect((await env.DB.prepare("SELECT live_snapshot_id FROM sources WHERE id='21run'").first<{live_snapshot_id:string}>())!.live_snapshot_id).toBe('previous-good-snapshot');
  expect((await advanceCatalogue(env,run)).status).toBe('failed');
 });
},15000);

test('a temporary retailer failure backs off and retries the same product without skipping it',async()=>{
 let requests=0;
 await scenario(async(env,run,db)=>{
  await checkpoint(env,run);
  expect((await advanceCatalogue(env,run)).status).toBe('retrying');
  expect((await advanceCatalogue(env,run)).status).toBe('retrying');
  expect(requests).toBe(1); // A poll during the backoff makes no retailer requests.
  const saved=db.query<{value:string},[string]>('SELECT value FROM app_state WHERE key=?').get(`crawl:${run}:21run`);
  expect(JSON.parse(saved!.value).products).toBe(0);
  expireRetry(db,run);
  expect(await advanceCatalogue(env,run)).toMatchObject({done:true,status:'complete',checked:1,rejected:0});
  expect(db.query('SELECT value FROM app_state WHERE key=?').get(`crawl:${run}:21run:retry`)).toBeNull();
 },url=>url.includes('/sizeselector/')&&++requests===1?new Response('',{status:503}):null);
},15000);

test('persistent retailer failures stop after three attempts rather than looping forever',async()=>{
 let requests=0;
 await scenario(async(env,run,db)=>{
  await checkpoint(env,run);
  for(let n=1;n<=3;n++){
   expect((await advanceCatalogue(env,run)).done).toBe(n===3);
   expireRetry(db,run);
  }
  expect((await advanceCatalogue(env,run)).status).toBe('failed');
  expect(requests).toBe(3);
 },url=>url.includes('/sizeselector/')?(requests++,new Response('',{status:503})):null);
},15000);

test('robots restrictions are permanent failures, never product skips or automatic retries',async()=>{
 let requests=0;
 await scenario(async(env,run)=>{
  await checkpoint(env,run);
  expect(await advanceCatalogue(env,run)).toMatchObject({done:true,status:'failed',error:'21RUN robots.txt disallows this request'});
  expect((await advanceCatalogue(env,run)).done).toBe(true);
  expect(requests).toBe(1);
 },url=>url.endsWith('/robots.txt')?(requests++,new Response('User-agent: *\nDisallow: /')):null);
},10000);

test('a new email slot resumes the existing catalogue instead of starting again',async()=>{
 await scenario(async(env,run)=>{
  await checkpoint(env,run);
  const later=crypto.randomUUID(),now=new Date().toISOString();
  await env.DB.prepare("INSERT INTO scan_runs(id,slot_key,status,started_at,heartbeat_at) VALUES(?,?,'complete',?,?)").bind(later,later,now,now).run();
  expect(await advanceCatalogue(env,later)).toMatchObject({done:true,status:'complete',checked:1});
  const source=await env.DB.prepare("SELECT live_snapshot_id FROM sources WHERE id='21run'").first<{live_snapshot_id:string}>();
  expect(source!.live_snapshot_id).toBe(`${run}:21run:full`);
  expect(await advanceCatalogue(env,later)).toMatchObject({done:true,status:'complete',skipped:true});
 });
},10000);
