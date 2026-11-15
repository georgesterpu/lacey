import type { Env, Offer, Watch } from './types';
import { categories, discount, freshCutoff, matches } from './types';
import { initializeSources, scan } from './scan';
import {advanceCatalogue} from './catalogue-job';
import { device, digest, rateLimit } from './identity';
import { emailReady, sendConfirmation } from './email';
import { shopFlag, shopLocation } from './shops';
import { planDigests, dispatchDigests } from './outbox';
import { escapeHtml, digestEmail } from './email-template';
import { nextCheck } from './schedule';
import { sources as approvedSources } from './sources';
import { currentDeals } from './catalogue';
import { shoeCards } from './shoe-identity';
import { releaseUnsentRecommendations } from './recommendations';
import html from '../public/index.html' with {type:'text'};
import css from '../public/style.css' with {type:'text'};
const signedEmailRoutes=new Set(['/confirm-email','/unsubscribe','/unsubscribe-all','/api/unsubscribe']);
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export function groupOffers(offers:Offer[]) {
 const groups=new Map<string,Offer & {sizes:string[];discount:number;sizeUrls:Record<string,string>}>();
 for(const o of offers){const key=[o.source_id,o.product_id,o.price,o.reference_price,o.colour,o.size_system].join('|');const found=groups.get(key);if(found){found.sizes.push(o.size);if(o.url!==found.url)found.sizeUrls[o.size]=o.url;}else groups.set(key,{...o,sizes:[o.size],discount:discount(o),sizeUrls:{}});}
 return [...groups.values()].map(g=>({...g,sizes:[...new Set(g.sizes)].sort((a,b)=>Number(a)-Number(b))})).sort((a,b)=>b.discount-a.discount||a.price-b.price);
}
async function body(request:Request) { if(Number(request.headers.get('Content-Length'))>12000)throw new Error('Request too large');const text=await request.text();if(text.length>12000)throw new Error('Request too large');return JSON.parse(text) as Record<string,unknown>; }
export async function handle(request:Request,env:Env,clientCode:string):Promise<Response> {
 const identity=await device(request);
 const response=await route(request,env,clientCode,identity.owner);
 // Random device capability, never an email address or a browser-readable identifier.
 if(['/api/dashboard','/confirm-email'].includes(new URL(request.url).pathname))response.headers.set('Set-Cookie',identity.cookie);
 response.headers.set('X-Content-Type-Options','nosniff');
 response.headers.set('Referrer-Policy',signedEmailRoutes.has(new URL(request.url).pathname)?'strict-origin':'strict-origin-when-cross-origin');
 return response;
}
async function route(request:Request,env:Env,clientCode:string,user:string):Promise<Response> {
 const url=new URL(request.url);const path=url.pathname;const method=request.method;
 // Signed email links authorize themselves with an unpredictable token, not a
 // browser cookie. Privacy settings can send Origin: null on their form POSTs.
 if(!signedEmailRoutes.has(path)&&method!=='GET'&&request.headers.get('Origin')&&request.headers.get('Origin')!==url.origin)return json({error:'Please submit from this website'},403);
 if(path==='/style.css')return new Response(css,{headers:{'Content-Type':'text/css; charset=utf-8','Cache-Control':'no-cache'}});
 if(path==='/app.js')return new Response(clientCode,{headers:{'Content-Type':'text/javascript; charset=utf-8','Cache-Control':'no-cache'}});
 if(path.startsWith('/api/internal/')){
  if(!env.CRON_SECRET||request.headers.get('Authorization')!==`Bearer ${env.CRON_SECRET}`)return json({error:'Scheduler authorization required. This endpoint is called by the deterministic scheduler, not a ChatGPT task.'},401);
  if(method!=='POST')return json({error:'Use POST'},405);
  if(path==='/api/internal/scan')return json(await scan(env));
  if(path==='/api/internal/catalogue'){const input=await body(request),runId=String(input.runId??'');if(!/^[a-f0-9-]{36}$/.test(runId))return json({error:'Invalid run'},400);return json(await advanceCatalogue(env,runId));}
  if(path==='/api/internal/dispatch'){
   const input=await body(request),runId=String(input.runId??'');if(!/^[a-f0-9-]{36}$/.test(runId))return json({error:'Invalid run'},400);
   const plan=await planDigests(env,runId),delivery=await dispatchDigests(env,runId);
   return json({plan,delivery});
  }
  return json({error:'Not found'},404);
 }
 if(path==='/email-preview'){
  const offers=shoeCards(await currentDeals(env,2000)).slice(0,3).flatMap(c=>c.options.slice(0,3));
  return new Response(digestEmail(offers,env.APP_URL??url.origin,'/#my-watches',true).html,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store'}});
 }
 if(path==='/confirm-email'){
  if(method!=='GET'&&method!=='POST')return new Response('Use GET or POST',{status:405});
  const token=url.searchParams.get('token');if(!token||!/^([a-f0-9]{64})$/.test(token))return new Response('This confirmation link is invalid.',{status:400});
  const hash=await digest(token);
  const row=await env.DB.prepare('SELECT owner_id,email FROM email_identities WHERE token_hash=? AND expires_at>?').bind(hash,new Date().toISOString()).first<{owner_id:string;email:string}>()
   ??await env.DB.prepare('SELECT w.owner_id,w.email FROM email_confirmations c JOIN watches w ON w.id=c.watch_id WHERE c.token_hash=? AND c.expires_at>?').bind(hash,new Date().toISOString()).first<{owner_id:string;email:string}>();
  if(!row)return page('This link has expired.','Open your watchlist to request a fresh verification email.');
  // The email link proves possession, but a mail scanner's GET cannot opt in.
  if(method==='POST'){
   const now=new Date().toISOString();
   await env.DB.batch([
    ...[...new Set([row.owner_id,user])].flatMap(owner=>[
     env.DB.prepare("INSERT INTO email_identities(owner_id,email,verified_at,delivery_state) VALUES(?,?,?,'verified') ON CONFLICT(owner_id,email) DO UPDATE SET verified_at=excluded.verified_at,delivery_state='verified',token=NULL,error_code=NULL,lease_until=NULL").bind(owner,row.email,now),
     env.DB.prepare('UPDATE watches SET email_verified=1 WHERE owner_id=? AND email=?').bind(owner,row.email)
    ]),
    env.DB.prepare('DELETE FROM email_confirmations WHERE watch_id IN(SELECT id FROM watches WHERE owner_id=? AND email=?)').bind(row.owner_id,row.email),
    env.DB.prepare('INSERT INTO subscribers(email_hash,email,unsubscribe_token) VALUES(?,?,?) ON CONFLICT(email_hash) DO UPDATE SET unsubscribed=0').bind(await digest(row.email),row.email,crypto.randomUUID())
   ]);
   const watches=(await env.DB.prepare('SELECT * FROM watches WHERE owner_id=? AND email=? AND active=1').bind(row.owner_id,row.email).all<Watch>()).results;
   const cards=shoeCards((await currentDeals(env)).filter(o=>watches.some(w=>matches(w,o))));
   const preview=cards.slice(0,3).map(c=>`<article class="confirmation-find"><h2>${escapeHtml(c.offer.title)}</h2>${c.options.map(o=>`<a href="${escapeHtml(o.url)}" target="_blank" rel="noopener noreferrer">${shopFlag(o.source_id)} ${escapeHtml(approvedSources.find(s=>s.id===o.source_id)?.name??o.source_id)} · ${escapeHtml(o.size_system==='unknown'?'Shop size':o.size_system)} ${escapeHtml(o.size)} · €${(o.price/100).toFixed(2)} ↗</a>`).join('')}</article>`).join('');
   return page('Email confirmed 😊',cards.length?`Your alerts are active. ${cards.length} matching ${cards.length===1?'shoe':'shoes'} in the latest check. Here’s a peek:`:'Your alerts are active. No matching deals right now. New alerts for this email will activate immediately in this browser.',undefined,preview+'<p>Checks at 08:00 and 20:00, Dublin time. We only send sale emails for new matches—no empty emails.</p>');}
  return page('Confirm your email.','One click, and we’ll keep an eye out for you.','Confirm my email');
 }
 if(path==='/unsubscribe-all'||path==='/api/unsubscribe'){
  const token=url.searchParams.get('token');if(!token||token.length>100)return page('This link is invalid.','Use the unsubscribe link in your email.');
  const person=await env.DB.prepare('SELECT email,email_hash FROM subscribers WHERE unsubscribe_token=?').bind(token).first<{email:string;email_hash:string}>();
  if(!person)return page('You’re all set.','This email subscription is no longer active.');
  if(method==='POST'){
   if(path==='/api/unsubscribe'){try{if((await request.formData()).get('List-Unsubscribe')!=='One-Click')return json({error:'Invalid unsubscribe request'},400);}catch{return json({error:'Invalid unsubscribe form'},400);}}
   await env.DB.batch([env.DB.prepare('UPDATE subscribers SET unsubscribed=1 WHERE email_hash=?').bind(person.email_hash),env.DB.prepare('UPDATE watches SET active=0 WHERE email=?').bind(person.email),env.DB.prepare("UPDATE digest_jobs SET status='suppressed',lease_until=NULL WHERE email_hash=? AND status IN('queued','sending')").bind(person.email_hash)]);
   const jobs=(await env.DB.prepare("SELECT id FROM digest_jobs WHERE email_hash=? AND status='suppressed'").bind(person.email_hash).all<{id:string}>()).results;
   for(const job of jobs)await releaseUnsentRecommendations(env,job.id);
   return page('You’re unsubscribed 😊','All sale emails have stopped. You don’t need to do anything else.');
  }
  if(method!=='GET')return new Response('Use GET or POST',{status:405});
  if(path==='/api/unsubscribe')return Response.redirect(`${url.origin}/unsubscribe-all?token=${encodeURIComponent(token)}`,303);
  // A mail scanner following GET links must never unsubscribe a person.
  return page('Stop all sale emails?','No sign-in. No email to type. One button and you’re done.','Unsubscribe — stop all sale emails');
 }
 if(path==='/unsubscribe'){
  const token=url.searchParams.get('token');if(!token||token.length>100)return new Response('Invalid link',{status:400});
  if(method==='POST'){await env.DB.prepare('DELETE FROM watches WHERE unsubscribe_token=?').bind(token).run();return page('Watch removed 😊','You can start another whenever a new shoe catches your eye.');}
  return page('Stop this shoe alert?','You won’t receive any more emails for this watch.','Stop this watch');
 }
 if(path.startsWith('/api/')){
  if(method!=='GET' && request.headers.get('Origin') && request.headers.get('Origin')!==url.origin)return json({error:'Origin mismatch'},403);
  if(path==='/api/dashboard'&&method==='GET'){
   const existing=await env.DB.prepare('SELECT count(*) n FROM sources').first<{n:number}>();if(!existing?.n)await initializeSources(env);
   const [rows,sourceRows,last,watches]=await Promise.all([
    currentDeals(env).then(results=>({results})),
    env.DB.prepare('SELECT * FROM sources ORDER BY CASE adapter WHEN \'planned\' THEN 1 ELSE 0 END,name').all(),
    env.DB.prepare("SELECT value FROM app_state WHERE key='last_scan'").first<{value:string}>(),
    env.DB.prepare('SELECT id,kind,query,category,fit,size_system,size,colour,budget,min_discount,active,email_verified,created_at FROM watches WHERE owner_id=? ORDER BY created_at DESC').bind(user).all<Watch>()
   ]);
   const pipeline=await env.DB.prepare('SELECT id,status,started_at,completed_at FROM scan_runs ORDER BY started_at DESC LIMIT 1').first();
   return json({offers:groupOffers(rows.results),sources:sourceRows.results.map(s=>({...s,...shopLocation(String(s.id))})),lastScan:last?.value??null,nextCheck:nextCheck(),pipeline,verifications:(await env.DB.prepare(`SELECT min(w.id) watch_id,coalesce(i.delivery_state,'not_sent') status FROM watches w LEFT JOIN email_identities i ON i.owner_id=w.owner_id AND i.email=w.email WHERE w.owner_id=? AND w.email_verified=0 AND w.active=1 GROUP BY w.email`).bind(user).all()).results,watches:watches.results.map(w=>({...w,matchCount:shoeCards(rows.results.filter(o=>matches(w,o))).length})),emailReady:emailReady(env)});
  }
  if(path==='/api/health'&&method==='GET'){
   const run=await env.DB.prepare('SELECT id,status,started_at,completed_at,attempts FROM scan_runs ORDER BY started_at DESC LIMIT 1').first<{id:string;status:string;completed_at:string|null}>();
   const checks=run?(await env.DB.prepare('SELECT source_id,status,products,variants,rejected,details,completed_at FROM source_runs WHERE run_id=?').bind(run.id).all()).results:[];
   const delivery=run?(await env.DB.prepare('SELECT status,count(*) count FROM digest_jobs WHERE run_id=? GROUP BY status').bind(run.id).all()).results:[];
   const housekeeping=await env.DB.prepare("SELECT value FROM app_state WHERE key='last_cleanup'").first<{value:string}>();
   const backup=await env.DB.prepare("SELECT value FROM app_state WHERE key='last_backup'").first<{value:string}>();
   return json({run,checks,delivery,lastCleanup:housekeeping?.value??null,lastBackup:backup?.value??null,nextCheck:nextCheck(),emailReady:emailReady(env),stale:run?.status==='failed'||!run?.completed_at||Date.now()-Date.parse(run.completed_at)>14*3600000});
  }
  if(!request.headers.get('Cookie')?.match(/(?:^|;\s*)brave_device=[a-f0-9]{64}(?:;|$)/))return json({error:'Please allow cookies for this site, then refresh to save your watch.'},401);
  if(method!=='GET'&&method!=='DELETE'&&!request.headers.get('Content-Type')?.startsWith('application/json'))return json({error:'Please submit using the form'},415);
  if(path==='/api/watches'&&method==='POST'){
   const data=await body(request);const kind=String(data.kind),query=String(data.query??'').trim(),category=String(data.category??'any'),fit=String(data.fit),size=String(data.size),budget=Number(data.budget),min=Number(data.min_discount??25),email=String(data.email??'').trim().toLowerCase(),sizeSystem=String(data.size_system??'UK');
   if(sizeSystem!=='UK'&&!(kind==='model'&&approvedSources.some(s=>sizeSystem===`STORE:${s.id}`)))return json({error:'Choose a supported size system'},400);
   if(!['category','brand','model'].includes(kind)||!categories.includes(category as typeof categories[number])||!['men','women','kids','any'].includes(fit)||!/^\d{1,2}(\.5)?$/.test(size)||Number(size)<(fit==='kids'?.5:2)||Number(size)>(fit==='kids'?13.5:15)||!Number.isFinite(budget)||budget<1500||budget>50000||!Number.isInteger(budget)||![20,25,30,40].includes(min)||query.length>100||(kind!=='category'&&!query))return json({error:'Check your shoe, size and budget'},400);
   if(data.consent!==true)return json({error:'Please agree to email alerts for this watch'},400);
   if(email.length>254||!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))return json({error:'Enter a valid email address'},400);
   const emailCount=await env.DB.prepare('SELECT count(*) n FROM watches WHERE email=?').bind(email).first<{n:number}>();if((emailCount?.n??0)>=50)return json({error:'This email has reached the watch limit. Remove an old watch first.'},400);
   const count=await env.DB.prepare('SELECT count(*) AS n FROM watches WHERE owner_id=?').bind(user).first<{n:number}>();if((count?.n??0)>=10)return json({error:'You can keep up to 10 watches. Remove one to add another.'},400);
   if(!await rateLimit(env,request,'watch',60))return json({error:'Too many watches created. Please try again in an hour.'},429);
   const id=crypto.randomUUID(),now=new Date().toISOString();
   const verified=await env.DB.prepare('SELECT owner_id FROM email_identities WHERE owner_id=? AND email=? AND verified_at IS NOT NULL').bind(user,email).first();
   await env.DB.prepare('INSERT INTO watches(id,owner_id,email,kind,query,category,fit,size_system,size,colour,budget,min_discount,created_at,consent_at,unsubscribe_token) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,user,email,kind,query,category,fit,sizeSystem,String(Number(size)),String(data.colour??'').trim().slice(0,60),budget,min,now,now,crypto.randomUUID()).run();
   if(verified){await env.DB.batch([env.DB.prepare('UPDATE watches SET email_verified=1 WHERE id=?').bind(id),env.DB.prepare('UPDATE subscribers SET unsubscribed=0 WHERE email_hash=?').bind(await digest(email))]);return json({id,confirmation:'confirmed'},201);}
   return json({id,confirmation:await sendConfirmation(env,{id,email})},201);
  }
  const previewWatch=path.match(/^\/api\/watches\/([a-f0-9-]{36})\/matches$/);
  if(previewWatch&&method==='GET'){const watch=await env.DB.prepare('SELECT * FROM watches WHERE id=? AND owner_id=?').bind(previewWatch[1],user).first<Watch>();if(!watch)return json({error:'Watch not found'},404);return json({cards:shoeCards((await currentDeals(env)).filter(o=>matches(watch,o))).slice(0,6)});}
  const match=path.match(/^\/api\/watches\/([a-f0-9-]{36})$/);
  if(match&&method==='DELETE'){await env.DB.prepare('DELETE FROM watches WHERE id=? AND owner_id=?').bind(match[1],user).run();return json({ok:true});}
  if(match&&method==='PATCH'){const data=await body(request);if(typeof data.active!=='boolean')return json({error:'Invalid state'},400);const watch=await env.DB.prepare('SELECT email,email_verified FROM watches WHERE id=? AND owner_id=?').bind(match[1],user).first<{email:string;email_verified:number}>();if(!watch)return json({error:'Watch not found'},404);const writes=[env.DB.prepare('UPDATE watches SET active=? WHERE id=? AND owner_id=?').bind(data.active?1:0,match[1],user)];if(data.active&&watch.email_verified)writes.push(env.DB.prepare('UPDATE subscribers SET unsubscribed=0 WHERE email_hash=?').bind(await digest(watch.email)));await env.DB.batch(writes);return json({ok:true});}
  const resend=path.match(/^\/api\/watches\/([a-f0-9-]{36})\/confirm$/);
  if(resend&&method==='POST'){const watch=await env.DB.prepare('SELECT id,email,owner_id FROM watches WHERE id=? AND owner_id=? AND email_verified=0').bind(resend[1],user).first<Pick<Watch,'id'|'email'>>();if(!watch)return json({error:'Watch not found'},404);return json({confirmation:await sendConfirmation(env,watch,true)});}
  if(path==='/api/feedback'&&method==='POST'){
   const data=await body(request);const message=String(data.message??'').trim(),kind=String(data.kind??'idea');
   if(message.length<5||message.length>2000||!['idea','source','issue'].includes(kind))return json({error:'Write between 5 and 2,000 characters'},400);
   if(!await rateLimit(env,request,'feedback',10))return json({error:'Please try again later'},429);
   const recent=await env.DB.prepare('SELECT count(*) AS n FROM feedback WHERE owner_id=? AND created_at>?').bind(user,new Date(Date.now()-3600000).toISOString()).first<{n:number}>();if((recent?.n??0)>=5)return json({error:'Thanks for the ideas. Try again in an hour.'},429);
   await env.DB.prepare('INSERT INTO feedback VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),user,kind,message,new Date().toISOString()).run();return json({ok:true},201);
  }
  return json({error:'Not found'},404);
 }
 if(path==='/'&&method==='GET')return new Response(html as unknown as string,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://cdn.shopify.com https://images.21run.com https://img.runningwarehouse.eu https://www.lifestylesports.com data:; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'"}});
 return new Response('Not found',{status:404});
}
function page(title:string,message:string,button?:string,extra='') {return new Response(`<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="referrer" content="strict-origin"><title>Lacey</title><link rel="stylesheet" href="/style.css"></head><body><main class="message-page"><a href="/" class="brand">lacey 😊</a><h1>${title}</h1><p>${message}</p>${extra}${button?`<form method="post"><button class="button button-dark">${button}</button></form>`:''}<a href="/" class="text-link">Back to deals</a></main></body></html>`,{headers:{'Content-Type':'text/html; charset=utf-8','Cache-Control':'no-store','Referrer-Policy':'strict-origin'}});}
