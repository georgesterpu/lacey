import type { Env, Offer } from './types';
import { collect, sources } from './sources';
import { scheduleSlot } from './schedule';
import {offerStatements} from './snapshots';
import { cleanup } from './retention';
const connectionNotes:Record<string,string>={warehouse:'Paused: customer product links and verification returned HTTP 406. Not publishing offers until browser access is reliable.',misterrunning:'Catalogue accessible; product verification returned HTTP 403. Requires an approved size/stock feed.', sportsdirect:'Connection test timed out; automatic price/size checks are not connected.'};
export async function initializeSources(env:Env) {await env.DB.batch(sources.map(s=>env.DB.prepare('INSERT INTO sources(id,name,url,adapter,error) VALUES(?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,adapter=excluded.adapter,error=CASE WHEN excluded.adapter=\'planned\' THEN excluded.error ELSE sources.error END').bind(s.id,s.name,s.url,s.adapter,connectionNotes[s.id]??null)));}
export async function scan(env:Env) {
 await initializeSources(env);const now=new Date().toISOString(),slot=scheduleSlot(),id=crypto.randomUUID();
 // Retries reuse the same run and snapshot namespace; only a stale lease or an
 // explicit failed run can be retried, and at most three attempts are admitted.
 await env.DB.prepare("INSERT INTO scan_runs(id,slot_key,status,started_at,heartbeat_at) VALUES(?,?,'running',?,?) ON CONFLICT(slot_key) DO NOTHING").bind(id,slot,now,now).run();
 let run=await env.DB.prepare('SELECT id,status,attempts,heartbeat_at FROM scan_runs WHERE slot_key=?').bind(slot).first<{id:string;status:string;attempts:number;heartbeat_at:string}>();
 if(run!.id!==id){
  if(run!.status==='complete'&&run!.attempts<3){const done=(await env.DB.prepare('SELECT source_id FROM source_runs WHERE run_id=?').bind(run!.id).all<{source_id:string}>()).results;const added=sources.some(s=>s.adapter!=='planned'&&s.adapter!=='twentyone'&&!done.some(d=>d.source_id===s.id));if(added){await env.DB.prepare("UPDATE scan_runs SET status='partial' WHERE id=? AND status='complete'").bind(run!.id).run();run!.status='partial';}}
  const leaseExpired=run!.heartbeat_at<new Date(Date.now()-10*60000).toISOString();
  if(run!.attempts>=3||!((['failed','partial'].includes(run!.status))||(run!.status==='running'&&leaseExpired))){if(run!.status!=='running')await cleanup(env);return {runId:run!.id,status:run!.status,skipped:true};}
  const lease=crypto.randomUUID();await env.DB.prepare("UPDATE scan_runs SET status='running',attempts=attempts+1,heartbeat_at=? WHERE id=? AND attempts<3 AND (status IN('failed','partial') OR (status='running' AND heartbeat_at<?))").bind(`${now}|${lease}`,run!.id,new Date(Date.now()-10*60000).toISOString()).run();
  const check=await env.DB.prepare('SELECT heartbeat_at FROM scan_runs WHERE id=?').bind(run!.id).first<{heartbeat_at:string}>();if(check?.heartbeat_at!==`${now}|${lease}`)return {runId:run!.id,status:'running',skipped:true};
 }
 const runId=run!.id,reports=[];
 try{
  for(const source of sources.filter(s=>s.adapter!=='planned'&&s.adapter!=='twentyone')){
   const already=await env.DB.prepare('SELECT status FROM source_runs WHERE run_id=? AND source_id=?').bind(runId,source.id).first<{status:string}>();if(already&&['complete','partial'].includes(already.status)){reports.push({source:source.name,status:already.status});continue;}
   await env.DB.prepare('UPDATE sources SET last_attempt=? WHERE id=?').bind(now,source.id).run();
   try{
    const {offers,complete,rejected,held}=await collect(source,now);if(!offers.length)throw new Error('No usable variants; previous snapshot kept');
    const count=new Set(offers.map(o=>o.product_id)).size,prior=await env.DB.prepare('SELECT product_count FROM sources WHERE id=?').bind(source.id).first<{product_count:number}>();
    if(complete&&(prior?.product_count??0)>=50&&count<prior!.product_count*.5)throw new Error('Catalogue shrank by over 50%; snapshot quarantined for review');
    const snapshot=`${runId}:${source.id}`;
    await env.DB.prepare('DELETE FROM offer_snapshots WHERE snapshot_id=?').bind(snapshot).run();
    for(let start=0;start<offers.length;start+=500){await env.DB.batch(offerStatements(env,runId,offers.slice(start,start+500)));await env.DB.prepare('UPDATE scan_runs SET heartbeat_at=? WHERE id=?').bind(new Date().toISOString(),runId).run();}
    // Publish the entire source in one atomic transaction. Failed/incomplete writes
    // never change the live pointer, so readers keep the previous good snapshot.
    await env.DB.batch([
     env.DB.prepare('INSERT INTO source_runs(run_id,source_id,status,products,variants,rejected,details,completed_at) VALUES(?,?,?,?,?,?,?,?) ON CONFLICT(run_id,source_id) DO UPDATE SET status=excluded.status,products=excluded.products,variants=excluded.variants,rejected=excluded.rejected,details=excluded.details,completed_at=excluded.completed_at').bind(runId,source.id,complete?'complete':'partial',count,offers.length,rejected,[!complete?(source.adapter==='lifestyle'?'First 5 sale products per department; up to 10 listed sizes':source.adapter==='warehouse'?'First 24 product pages per department':'First 500 products per collection'):'',held?`${held} excluded or unsupported products`:''].filter(Boolean).join('; ')||null,new Date().toISOString()),
     env.DB.prepare('UPDATE sources SET live_snapshot_id=?,status=?,last_success=?,product_count=?,error=? WHERE id=?').bind(snapshot,complete?'live':'partial',now,count,complete?null:(source.adapter==='lifestyle'?'Coverage limited to 5 sale products per department and 10 listed sizes':source.adapter==='warehouse'?'Coverage limited to 24 verified product pages per department':'Coverage limited to 500 products per collection'),source.id)
    ]);
    await env.DB.prepare('INSERT INTO price_history(offer_id,price,observed_at) SELECT id,price,checked_at FROM offer_snapshots s WHERE snapshot_id=? AND COALESCE((SELECT price FROM price_history h WHERE h.offer_id=s.id ORDER BY observed_at DESC LIMIT 1),-1)!=s.price ON CONFLICT(offer_id,observed_at) DO NOTHING').bind(snapshot).run();
    reports.push({source:source.name,status:complete?'complete':'partial',products:count,variants:offers.length,rejected,held});
   }catch(e){const message=(e as Error).message.slice(0,350);await env.DB.batch([env.DB.prepare("UPDATE sources SET status='error',error=? WHERE id=?").bind(message,source.id),env.DB.prepare("INSERT INTO source_runs(run_id,source_id,status,details,completed_at) VALUES(?,?,'failed',?,?) ON CONFLICT(run_id,source_id) DO UPDATE SET status='failed',details=excluded.details,completed_at=excluded.completed_at").bind(runId,source.id,message,new Date().toISOString())]);reports.push({source:source.name,status:'failed',error:message});}
  }
  const counts=await env.DB.prepare("SELECT sum(CASE WHEN status IN('complete','partial') THEN 1 ELSE 0 END) good,sum(CASE WHEN status='failed' THEN 1 ELSE 0 END) bad FROM source_runs WHERE run_id=?").bind(runId).first<{good:number;bad:number}>();
  const status=!counts?.good?'failed':counts.bad?'partial':'complete',finished=new Date().toISOString();
  await env.DB.prepare('UPDATE scan_runs SET status=?,completed_at=?,heartbeat_at=?,errors_json=? WHERE id=?').bind(status,finished,finished,JSON.stringify(reports.filter(r=>r.status==='failed')),runId).run();
  if(counts?.good)await env.DB.prepare("INSERT INTO app_state(key,value) VALUES('last_scan',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(finished).run();
  await cleanup(env);
  return {runId,status,reports};
 }catch(e){await env.DB.prepare("UPDATE scan_runs SET status='failed',completed_at=?,errors_json=? WHERE id=?").bind(new Date().toISOString(),JSON.stringify([(e as Error).message]),runId).run();throw e;}
}
// Compatibility for callers; recipient delivery is implemented in the outbox.
export { dispatchDigests as sendAlerts } from './outbox';
