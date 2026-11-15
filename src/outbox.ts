import type { Env, Offer, Watch } from './types';
import { discount, matches } from './types';
import { digest, randomToken } from './identity';
import { digestEmail } from './email-template';
import { emailReady, reserveDelivery } from './email';
import { sameVerifiedOffer, validateProduct } from './validation';
interface Candidate {watchId:string;offerId:string;price:number;}
interface Job {id:string;run_id:string;email_hash:string;status:string;candidates:string;payload:string|null;attempts:number;created_at:string;}
export async function planDigests(env:Env,runId:string,limit=20){
 const run=await env.DB.prepare('SELECT status,started_at,cursor_email,planning_done FROM scan_runs WHERE id=?').bind(runId).first<{status:string;started_at:string;cursor_email:string;planning_done:number}>();
 if(!run||!['complete','partial'].includes(run.status))return {planned:0,done:false,error:'A successful source scan is required'};
 if(run.planning_done)return {planned:0,done:true};
 if(Date.now()-Date.parse(run.started_at)>6*3600000)return {planned:0,done:true,error:'Scan is too old for email planning'};
 const recipients=(await env.DB.prepare('SELECT email FROM watches WHERE active=1 AND email_verified=1 AND email>? GROUP BY email ORDER BY email LIMIT ?').bind(run.cursor_email,limit).all<{email:string}>()).results;
 let planned=0;
 for(const {email} of recipients){
  const hash=await digest(email);
  await env.DB.prepare('INSERT INTO subscribers(email_hash,email,unsubscribe_token) VALUES(?,?,?) ON CONFLICT(email_hash) DO NOTHING').bind(hash,email,randomToken()).run();
  const subscriber=await env.DB.prepare('SELECT unsubscribed FROM subscribers WHERE email_hash=?').bind(hash).first<{unsubscribed:number}>();
  if(!subscriber?.unsubscribed){
   const watches=(await env.DB.prepare('SELECT * FROM watches WHERE email=? AND active=1 AND email_verified=1 ORDER BY id LIMIT 100').bind(email).all<Watch>()).results;
   const candidates:Candidate[]=[];const seen=new Set<string>();
   for(const w of watches){
    // The size/fit/price index reduces each query to a small matching bucket.
    // No per-subscriber crawling and no watches × full-catalogue in-memory scan.
    const rows=(await env.DB.prepare(`SELECT o.* FROM offer_snapshots o JOIN sources s ON s.id=o.source_id AND s.live_snapshot_id=o.snapshot_id WHERE o.run_id=? AND o.size_system=? AND o.size=? AND (?='' OR o.source_id=?) AND o.available=1 AND o.price<=? AND o.reference_price>o.price AND o.price*100<=o.reference_price*(100-?) AND (?='any' AND o.fit IN('men','women','unisex') OR o.fit=? OR (? IN('men','women') AND o.fit='unisex')) AND (?!='category' OR ?='any' OR o.category=?) AND (?!='brand' OR o.brand=?) AND NOT EXISTS(SELECT 1 FROM notifications n WHERE n.watch_id=? AND n.offer_id=o.id AND n.status='sent' AND n.price<=o.price) ORDER BY o.price LIMIT 30`).bind(runId,w.size_system.startsWith('STORE:')?'unknown':w.size_system,w.size,w.size_system.startsWith('STORE:')?w.size_system.slice(6):'',w.size_system.startsWith('STORE:')?w.size_system.slice(6):'',w.budget,w.min_discount,w.fit,w.fit,w.fit,w.kind,w.category,w.category,w.kind,w.query.toUpperCase(),w.id).all<Offer>()).results;
    for(const offer of rows.filter(o=>matches(w,o)).sort((a,b)=>discount(b)-discount(a))){const key=`${offer.source_id}:${offer.product_id}:${offer.size}:${offer.fit}`;if(seen.has(key))continue;seen.add(key);candidates.push({watchId:w.id,offerId:offer.id,price:offer.price});if(candidates.length>=12)break;}if(candidates.length>=12)break;
   }
   if(candidates.length){await env.DB.prepare('INSERT INTO digest_jobs(id,run_id,email_hash,candidates,created_at) VALUES(?,?,?,?,?) ON CONFLICT(run_id,email_hash) DO NOTHING').bind(`${runId}:${hash}`,runId,hash,JSON.stringify(candidates),new Date().toISOString()).run();planned++;}
  }
  await env.DB.prepare('UPDATE scan_runs SET cursor_email=? WHERE id=?').bind(email,runId).run();
 }
 const done=recipients.length<limit;if(done)await env.DB.prepare('UPDATE scan_runs SET planning_done=1 WHERE id=?').bind(runId).run();
 return {planned,done};
}
export async function dispatchDigests(env:Env,runId?:string,limit=5){
 if(!emailReady(env))return {sent:0,status:'not_configured',remaining:0};
 if(!runId)return {sent:0,status:'run_required',remaining:0};
 const run=await env.DB.prepare('SELECT started_at,status FROM scan_runs WHERE id=?').bind(runId).first<{started_at:string;status:string}>();
 if(!run||!['complete','partial'].includes(run.status)||Date.now()-Date.parse(run.started_at)>6*3600000)return {sent:0,status:'scan_expired',remaining:0};
 const now=new Date().toISOString();
 await env.DB.prepare("UPDATE digest_jobs SET status='queued',lease_until=NULL WHERE run_id=? AND status='sending' AND lease_until<?").bind(runId,now).run();
 const jobs=(await env.DB.prepare("SELECT * FROM digest_jobs WHERE run_id=? AND status='queued' AND (next_attempt_at IS NULL OR next_attempt_at<=?) ORDER BY created_at,id LIMIT ?").bind(runId,now,limit).all<Job>()).results;
 let sent=0,blocked=0;
 for(const job of jobs){
  const lease=`${new Date(Date.now()+5*60000).toISOString()}|${randomToken()}`;await env.DB.prepare("UPDATE digest_jobs SET status='sending',lease_until=? WHERE id=? AND status='queued'").bind(lease,job.id).run();
  const held=await env.DB.prepare('SELECT lease_until,status FROM digest_jobs WHERE id=?').bind(job.id).first<{lease_until:string;status:string}>();if(held?.lease_until!==lease||held.status!=='sending')continue;
  const subscriber=await env.DB.prepare('SELECT email,unsubscribe_token,unsubscribed FROM subscribers WHERE email_hash=?').bind(job.email_hash).first<{email:string;unsubscribe_token:string;unsubscribed:number}>();
  if(!subscriber||subscriber.unsubscribed){await suppress(env,job.id,'Unsubscribed');continue;}
  const candidates:Candidate[]=JSON.parse(job.candidates),valid:Offer[]=[],validCandidates:Candidate[]=[];
  for(const candidate of candidates){
   const w=await env.DB.prepare('SELECT * FROM watches WHERE id=? AND email=? AND active=1 AND email_verified=1').bind(candidate.watchId,subscriber.email).first<Watch>();if(!w)continue;
   const offer=await env.DB.prepare('SELECT o.* FROM offer_snapshots o JOIN sources s ON s.live_snapshot_id=o.snapshot_id AND s.id=o.source_id WHERE s.id=? AND o.id=? AND o.run_id=?').bind(candidate.offerId.split(':')[0],candidate.offerId,runId).first<Offer>();if(!offer||offer.price!==candidate.price||!matches(w,offer))continue;
   const verified=await validateProduct(env,runId,offer),live=verified.find(o=>sameVerifiedOffer(offer,o));
   if(!live||!matches(w,live)){blocked++;continue;}valid.push(live);validCandidates.push(candidate);if(valid.length>=6)break;
  }
  if(!valid.length){await suppress(env,job.id,'No fresh, verified matches');continue;}
  if(job.payload){const frozen=JSON.parse(job.payload) as {ids:string[]};if(frozen.ids.join('|')!==valid.map(o=>`${o.id}:${o.price}`).join('|')){await suppress(env,job.id,'Candidates changed during retry');continue;}}
  const stop=`${env.APP_URL}/unsubscribe-all?token=${subscriber.unsubscribe_token}`;
  const content=digestEmail(valid,env.APP_URL!,stop),payload=job.payload??JSON.stringify({from:env.EMAIL_FROM,to:[subscriber.email],subject:`A little shoe joy from Lacey 😊 — ${valid.length} ${valid.length===1?'find':'finds'} in your size`,html:content.html,text:content.text,ids:valid.map(o=>`${o.id}:${o.price}`)});
  if(!job.payload)await env.DB.prepare('UPDATE digest_jobs SET payload=? WHERE id=?').bind(payload,job.id).run();
  if(!await reserveDelivery(env)){await env.DB.prepare("UPDATE digest_jobs SET status='queued',lease_until=NULL,error='Daily email budget reached' WHERE id=?").bind(job.id).run();return {sent,status:'daily_limit',remaining:await remaining(env,runId),blocked};}
  try{
   const message=JSON.parse(payload);delete message.ids;
   const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':job.id},body:JSON.stringify(message),signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new Error(`Email provider HTTP ${response.status}`);
   const result=await response.json() as {id?:string};
   await env.DB.batch([env.DB.prepare("UPDATE digest_jobs SET status='sent',sent_at=?,attempts=attempts+1,lease_until=NULL,error=NULL,provider_id=? WHERE id=?").bind(new Date().toISOString(),result.id??null,job.id),...validCandidates.map(c=>env.DB.prepare("INSERT INTO notifications(id,watch_id,offer_id,price,status,created_at,sent_at) SELECT ?,?,?,?,'sent',?,? WHERE EXISTS(SELECT 1 FROM watches WHERE id=?) ON CONFLICT(watch_id,offer_id,price) DO UPDATE SET status='sent',sent_at=excluded.sent_at").bind(`${c.watchId}:${c.offerId}:${c.price}`,c.watchId,c.offerId,c.price,now,now,c.watchId))]);sent++;
  }catch(e){const failed=job.attempts>=2||Date.now()-Date.parse(job.created_at)>23*3600000;await env.DB.prepare('UPDATE digest_jobs SET status=?,attempts=attempts+1,lease_until=NULL,next_attempt_at=?,error=? WHERE id=?').bind(failed?'failed':'queued',new Date(Date.now()+Math.min(20,2**job.attempts)*60000).toISOString(),(e as Error).message,job.id).run();}
 }
 return {sent,status:'configured',remaining:await remaining(env,runId),blocked};
}
async function remaining(env:Env,runId:string){return (await env.DB.prepare("SELECT count(*) n FROM digest_jobs WHERE run_id=? AND status IN('queued','sending')").bind(runId).first<{n:number}>())?.n??0;}
async function suppress(env:Env,id:string,reason:string){await env.DB.prepare("UPDATE digest_jobs SET status='suppressed',lease_until=NULL,error=? WHERE id=?").bind(reason,id).run();}
