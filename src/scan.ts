import {retryTransient} from './transient';
import type { Env, Offer } from './types';
import { collect, sources, StoreUnavailableError } from './sources';
import { scheduleSlot } from './schedule';
import {offerStatements,inventorySummary} from './snapshots';
import {publicSourceStatement,publicFailureStatement,publicStateStatement,saleOffers,canRetainPublished} from './public-catalogue';
export async function initializeSources(env:Env) {await env.DB.batch(sources.map(s=>env.DB.prepare('INSERT INTO sources(id,name,url,adapter) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,adapter=excluded.adapter').bind(s.id,s.name,s.url,s.adapter)));}
export async function scan(env:Env) {
 await initializeSources(env);const now=new Date().toISOString(),slot=scheduleSlot(),id=crypto.randomUUID();
 // Retries reuse the same run and snapshot namespace; only a stale lease or an
 // explicit failed run can be retried, and at most three attempts are admitted.
 await env.DB.prepare("INSERT INTO scan_runs(id,slot_key,status,started_at,heartbeat_at) VALUES(?,?,'running',?,?) ON CONFLICT(slot_key) DO NOTHING").bind(id,slot,now,now).run();
 let run=await env.DB.prepare('SELECT id,status,attempts,heartbeat_at,completed_at FROM scan_runs WHERE slot_key=?').bind(slot).first<{id:string;status:string;attempts:number;heartbeat_at:string;completed_at:string|null}>();
 const refresh=run!.id!==id&&run!.status==='complete'&&(!run!.completed_at||run!.completed_at<new Date(Date.now()-6*3600000).toISOString());
 if(run!.id!==id){
  // A delayed cron may arrive hours after a manual/catch-up scan in this slot.
  // Recollect the feeds before delivery; retain the slot identity and receipts.
  if(refresh&&run!.attempts<3){await env.DB.prepare("UPDATE scan_runs SET status='partial' WHERE id=? AND status='complete'").bind(run!.id).run();run!.status='partial';}
  if(run!.status==='complete'&&run!.attempts<3){const done=(await env.DB.prepare('SELECT source_id FROM source_runs WHERE run_id=?').bind(run!.id).all<{source_id:string}>()).results;const added=sources.some(s=>!['planned','twentyone','catalogue'].includes(s.adapter)&&!done.some(d=>d.source_id===s.id));if(added){await env.DB.prepare("UPDATE scan_runs SET status='partial' WHERE id=? AND status='complete'").bind(run!.id).run();run!.status='partial';}}
  const leaseExpired=run!.heartbeat_at<new Date(Date.now()-10*60000).toISOString();
  if(run!.attempts>=3||!((['failed','partial'].includes(run!.status))||(run!.status==='running'&&leaseExpired))){
   const reports=run!.status==='partial'?(await env.DB.prepare("SELECT s.name AS source,r.status,r.details AS error FROM source_runs r JOIN sources s ON s.id=r.source_id WHERE r.run_id=? AND s.adapter NOT IN('planned','twentyone','catalogue')").bind(run!.id).all<{source:string;status:string;error:string|null}>()).results:undefined;
   return {runId:run!.id,status:run!.status,skipped:true,reports};
  }
  const lease=crypto.randomUUID();await env.DB.prepare("UPDATE scan_runs SET status='running',attempts=attempts+1,heartbeat_at=? WHERE id=? AND attempts<3 AND (status IN('failed','partial') OR (status='running' AND heartbeat_at<?))").bind(`${now}|${lease}`,run!.id,new Date(Date.now()-10*60000).toISOString()).run();
  const check=await env.DB.prepare('SELECT heartbeat_at FROM scan_runs WHERE id=?').bind(run!.id).first<{heartbeat_at:string}>();if(check?.heartbeat_at!==`${now}|${lease}`)return {runId:run!.id,status:'running',skipped:true};
 }
 const runId=run!.id,reports=[];
 try{
  for(const source of sources.filter(s=>!['planned','twentyone','catalogue'].includes(s.adapter))){
   const pause=await env.DB.prepare('SELECT value FROM app_state WHERE key=?').bind(`ops:source-pause:${source.id}`).first<{value:string}>();
   if(pause){
    await env.DB.prepare("INSERT INTO source_runs(run_id,source_id,status,details,completed_at) VALUES(?,?,'paused',?,?) ON CONFLICT DO NOTHING").bind(runId,source.id,pause.value,now).run();
    reports.push({source:source.name,status:'paused',error:pause.value});continue;
   }
   const already=await env.DB.prepare('SELECT status FROM source_runs WHERE run_id=? AND source_id=?').bind(runId,source.id).first<{status:string}>();if(!refresh&&already&&['complete','partial','cached'].includes(already.status)){reports.push({source:source.name,status:already.status});continue;}
   await env.DB.prepare('UPDATE sources SET last_attempt=? WHERE id=?').bind(now,source.id).run();
   try{
    const {offers,complete,rejected,held}=await collect(source,now);if(!offers.length)throw new Error('No usable variants; previous snapshot kept');
    console.info('Source collected',{source:source.id,...inventorySummary(offers)});
    const count=new Set(offers.map(o=>o.product_id)).size,prior=await env.DB.prepare('SELECT product_count FROM sources WHERE id=?').bind(source.id).first<{product_count:number}>();
    if(complete&&(prior?.product_count??0)>=50&&count<prior!.product_count*.5)throw new Error('Catalogue shrank by over 50%; snapshot quarantined for review');
    const snapshot=`${runId}:${source.id}:${crypto.randomUUID()}`;
    const partial=!complete||rejected>0;
    const details=[!complete?(source.adapter==='lifestyle'?'Entry catalogue pages only; further pagination is disallowed by retailer robots rules':'Incomplete catalogue coverage'):'',rejected?`${rejected} invalid product records withheld`:'',held?`${held} unsupported products excluded`:''].filter(Boolean).join('; ')||null;
    // Persist the actionable sale catalogue, not thousands of unavailable or
    // full-price sizes. Inventory totals above still describe the entire feed.
    const eligibleOffers=saleOffers(offers);
    for(let start=0;start<eligibleOffers.length;start+=100){await retryTransient(()=>env.DB.batch(offerStatements(env,runId,eligibleOffers.slice(start,start+100),snapshot)));await env.DB.prepare('UPDATE scan_runs SET heartbeat_at=? WHERE id=?').bind(new Date().toISOString(),runId).run();}
    // Publish the entire source in one atomic transaction. Failed/incomplete writes
    // never change the live pointer, so readers keep the previous good snapshot.
    await retryTransient(()=>env.DB.batch([
     publicSourceStatement(env,{id:source.id,name:source.name,url:source.url,adapter:source.adapter,status:partial?'partial':'live',last_attempt:now,last_success:now,product_count:count,live_snapshot_id:snapshot,error:partial?details:null,inventory:{snapshot,checkedAt:now,...inventorySummary(offers)}},eligibleOffers),
     env.DB.prepare("INSERT INTO app_state(key,value) VALUES(?,?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(`source-summary:${source.id}`,JSON.stringify({snapshot,checkedAt:now,...inventorySummary(offers)})),
     env.DB.prepare('INSERT INTO source_runs(run_id,source_id,status,products,variants,rejected,details,completed_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(run_id,source_id) DO UPDATE SET status=excluded.status,products=excluded.products,variants=excluded.variants,rejected=excluded.rejected,details=excluded.details,completed_at=excluded.completed_at').bind(runId,source.id,partial?'partial':'complete',count,offers.length,rejected,details,new Date().toISOString()),
     env.DB.prepare('UPDATE sources SET live_snapshot_id=?,status=?,last_success=?,product_count=?,error=? WHERE id=?').bind(snapshot,partial?'partial':'live',now,count,partial?details:null,source.id)
    ]));
    console.info('Source published',{source:source.id,products:count,variants:offers.length});
    reports.push({source:source.name,status:partial?'partial':'complete',products:count,variants:offers.length,rejected,held});
   }catch(e){const message=(e as Error).message.slice(0,350),retain=e instanceof StoreUnavailableError&&await canRetainPublished(env,source.id),status=retain?'cached':'failed';await env.DB.batch([publicFailureStatement(env,source.id,message,now,retain),env.DB.prepare("UPDATE sources SET status='error',error=? WHERE id=?").bind(message,source.id),env.DB.prepare("INSERT INTO source_runs(run_id,source_id,status,details,completed_at) VALUES(?,?,?,?,?) ON CONFLICT(run_id,source_id) DO UPDATE SET status=excluded.status,details=excluded.details,completed_at=excluded.completed_at").bind(runId,source.id,status,message,new Date().toISOString())]);reports.push({source:source.name,status,error:message});}
  }
  // Paged collectors share this run namespace but have independent jobs. Their
  // failures must not turn a successful small-feed refresh into a failed job.
  const counts={good:reports.filter(r=>['complete','partial'].includes(r.status)).length,cached:reports.filter(r=>r.status==='cached').length,bad:reports.filter(r=>r.status==='failed').length};
  const status=!counts.good&&!counts.cached?'failed':counts.bad||counts.cached?'partial':'complete',finished=new Date().toISOString();
  await env.DB.prepare('UPDATE scan_runs SET status=?,completed_at=?,heartbeat_at=?,errors_json=? WHERE id=?').bind(status,finished,finished,JSON.stringify(reports.filter(r=>r.status==='failed')),runId).run();
  if(counts?.good)await env.DB.prepare("INSERT INTO app_state(key,value) VALUES('last_scan',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(finished).run();
  const last=counts.good?finished:(await env.DB.prepare("SELECT value FROM app_state WHERE key='last_scan'").first<{value:string}>())?.value??null;
  await publicStateStatement(env,last,{id:runId,status,completed_at:finished}).run();
  return {runId,status,reports};
 }catch(e){await env.DB.prepare("UPDATE scan_runs SET status='failed',completed_at=?,errors_json=? WHERE id=?").bind(new Date().toISOString(),JSON.stringify([(e as Error).message]),runId).run();throw e;}
}
// Compatibility for callers; recipient delivery is implemented in the outbox.
export { dispatchDigests as sendAlerts } from './outbox';
