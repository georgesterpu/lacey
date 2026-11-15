import type { Env, Offer, Watch } from './types';
import { discount, freshCutoff, matches, money } from './types';
import { collect, sources } from './sources';
const escape = (s:string)=>s.replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
export async function initializeSources(env:Env) {
 await env.DB.batch(sources.map(s=>env.DB.prepare('INSERT INTO sources(id,name,url,adapter) VALUES(?,?,?,?) ON CONFLICT(id) DO UPDATE SET name=excluded.name,url=excluded.url,adapter=excluded.adapter').bind(s.id,s.name,s.url,s.adapter)));
}
export async function scan(env:Env) {
 const now=new Date().toISOString();const lockUntil=new Date(Date.now()+10*60000).toISOString();
 await initializeSources(env);
 const lock=crypto.randomUUID();
 await env.DB.prepare("INSERT INTO app_state(key,value) VALUES('scan_lock',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value WHERE app_state.value < ?").bind(`${lockUntil}|${lock}`,now).run();
 const held=await env.DB.prepare("SELECT value FROM app_state WHERE key='scan_lock'").first<{value:string}>();
 if(held?.value!==`${lockUntil}|${lock}`)return {skipped:true,reason:'A scan is already running'};
 const reports=[];
 try {
  for(const source of sources.filter(s=>s.adapter!=='planned')){
   await env.DB.prepare('UPDATE sources SET last_attempt=? WHERE id=?').bind(now,source.id).run();
   try{
    const {offers,complete}=await collect(source,now);
    // Empty or invalid feeds must not wipe the previous successful snapshot.
    if(!offers.length)throw new Error('No usable shoe variants found; previous snapshot retained');
    for(let start=0;start<offers.length;start+=40){
     await env.DB.batch(offers.slice(start,start+40).flatMap(o=>[
      env.DB.prepare('INSERT INTO price_history(offer_id,price,observed_at) SELECT ?,?,? WHERE COALESCE((SELECT price FROM price_history WHERE offer_id=? ORDER BY observed_at DESC LIMIT 1),-1) != ?').bind(o.id,o.price,now,o.id,o.price),
      env.DB.prepare('INSERT INTO offers(id,source_id,product_id,title,brand,category,fit,size_system,size,colour,price,reference_price,currency,image,url,available,checked_at) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?) ON CONFLICT(id) DO UPDATE SET title=excluded.title,brand=excluded.brand,category=excluded.category,fit=excluded.fit,size_system=excluded.size_system,size=excluded.size,colour=excluded.colour,price=excluded.price,reference_price=excluded.reference_price,image=excluded.image,url=excluded.url,available=excluded.available,checked_at=excluded.checked_at').bind(o.id,o.source_id,o.product_id,o.title,o.brand,o.category,o.fit,o.size_system,o.size,o.colour,o.price,o.reference_price,o.currency,o.image,o.url,o.available,now)
     ]));
    }
    // Only invalidate vanished stock after a fully successful, untruncated collection crawl.
    if(complete)await env.DB.prepare('UPDATE offers SET available=0 WHERE source_id=? AND checked_at < ?').bind(source.id,now).run();
    const count=new Set(offers.map(o=>o.product_id)).size;
    await env.DB.prepare('UPDATE sources SET status=?,last_success=?,product_count=?,error=? WHERE id=?').bind(complete?'live':'partial',now,count,complete?null:'Coverage limited to the first 500 products per collection',source.id).run();
    reports.push({source:source.name,products:count,status:complete?'live':'partial'});
   }catch(e){await env.DB.prepare("UPDATE sources SET status='error',error=? WHERE id=?").bind(String(e).slice(0,300),source.id).run();reports.push({source:source.name,status:'error'});}
  }
  await env.DB.prepare("INSERT INTO app_state(key,value) VALUES('last_scan',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value").bind(new Date().toISOString()).run();
  const email=await sendAlerts(env);
  // Bounded retention: changed prices for 90 days, terminal notifications for 90 days.
  const cutoff=new Date(Date.now()-90*86400000).toISOString();
  await env.DB.batch([env.DB.prepare('DELETE FROM price_history WHERE observed_at < ?').bind(cutoff),env.DB.prepare("DELETE FROM notifications WHERE created_at < ? AND status != 'pending'").bind(cutoff)]);
  return {reports,email};
 } finally {await env.DB.prepare("DELETE FROM app_state WHERE key='scan_lock' AND value=?").bind(`${lockUntil}|${lock}`).run();}
}
export async function sendAlerts(env:Env) {
 // No simulated sends or outbox growth when a sender has not been configured.
 if(!env.RESEND_API_KEY||!env.EMAIL_FROM||!env.APP_URL)return {sent:0,status:'not_configured'};
 const watches=(await env.DB.prepare('SELECT * FROM watches WHERE active=1').all<Watch & {unsubscribe_token:string}>()).results;
 const offers=(await env.DB.prepare('SELECT * FROM offers WHERE available=1 AND checked_at>=?').bind(freshCutoff()).all<Offer>()).results;
 let sent=0;
 for(const watch of watches){
  const candidates=offers.filter(o=>matches(watch,o)).sort((a,b)=>discount(b)-discount(a));
  const selected:Offer[]=[];const seen=new Set<string>();
  for(const offer of candidates){
   const key=`${offer.source_id}:${offer.product_id}`;if(seen.has(key))continue;seen.add(key);
   const prior=await env.DB.prepare('SELECT id FROM notifications WHERE watch_id=? AND offer_id=? AND price<=? AND status=\'sent\'').bind(watch.id,offer.id,offer.price).first();if(prior)continue;
   selected.push(offer);if(selected.length===3)break;
  }
  if(!selected.length)continue;
  // At most one digest for each watch per day, even with twice-daily checks.
  if(await env.DB.prepare("SELECT id FROM notifications WHERE watch_id=? AND status='sent' AND sent_at>=?").bind(watch.id,new Date(Date.now()-24*3600000).toISOString()).first())continue;
  const best=selected[0];const id=`${watch.id}:${best.id}:${best.price}`;
  const existing=await env.DB.prepare('SELECT status,created_at,attempts FROM notifications WHERE id=?').bind(id).first<{status:string;created_at:string;attempts:number}>();
  if(existing && (existing.status==='sent'||existing.attempts>=3||Date.now()-Date.parse(existing.created_at)>23*3600000))continue;
  const now=new Date().toISOString();
  await env.DB.prepare('INSERT INTO notifications(id,watch_id,offer_id,price,created_at) VALUES(?,?,?,?,?) ON CONFLICT(id) DO NOTHING').bind(id,watch.id,best.id,best.price,now).run();
  // A deterministic request body is important for provider idempotency on retries.
  const unsubscribe=`${env.APP_URL}/unsubscribe?token=${encodeURIComponent(watch.unsubscribe_token)}`;
  const html=`<div style="font-family:Arial,sans-serif;max-width:560px;margin:auto;color:#20392d"><p>BRAVE RUNNERS / SHOE WATCH</p><h1>A good price. In your size.</h1><p>${escape(best.title)} · ${escape(best.size_system)} ${escape(best.size)}</p><p><strong>${money(best.price)}</strong> · ${discount(best)}% below the retailer's reference price. Delivery extra; confirm the total at checkout.</p><p><a href="${escape(best.url)}">See the shoe at the retailer →</a></p><p>Stock was checked during our latest scan and can change. This is a retailer markdown, not a claim about the whole market. No coupon is included.</p><p><a href="${escape(unsubscribe)}">Stop this watch</a> · <a href="${escape(env.APP_URL)}">Manage your watchlist</a></p></div>`;
  try {
   const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':id},body:JSON.stringify({from:env.EMAIL_FROM,to:[watch.email],subject:`Your shoe watch: ${best.title} at ${money(best.price)}`,html}),signal:AbortSignal.timeout(15000)});
   if(!response.ok)throw new Error(`Email provider HTTP ${response.status}`);
   await env.DB.prepare("UPDATE notifications SET status='sent',sent_at=?,attempts=attempts+1,error=NULL WHERE id=?").bind(now,id).run();sent++;
  }catch(e){await env.DB.prepare("UPDATE notifications SET status='pending',attempts=attempts+1,error=? WHERE id=?").bind(String(e).slice(0,250),id).run();}
 }
 return {sent,status:'configured'};
}
