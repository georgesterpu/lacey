import type { Env, Offer, Watch } from './types';
import { categories, discount, freshCutoff, matches } from './types';
import { initializeSources, scan } from './scan';
import html from '../public/index.html' with {type:'text'};
import css from '../public/style.css' with {type:'text'};
const json=(body:unknown,status=200)=>new Response(JSON.stringify(body),{status,headers:{'Content-Type':'application/json','Cache-Control':'no-store'}});
export function groupOffers(offers:Offer[]) {
 const groups=new Map<string,Offer & {sizes:string[];discount:number}>();
 for(const o of offers){const key=[o.source_id,o.product_id,o.price,o.reference_price,o.colour,o.size_system].join('|');const found=groups.get(key);if(found)found.sizes.push(o.size);else groups.set(key,{...o,sizes:[o.size],discount:discount(o)});}
 return [...groups.values()].map(g=>({...g,sizes:[...new Set(g.sizes)].sort((a,b)=>Number(a)-Number(b))})).sort((a,b)=>b.discount-a.discount||a.price-b.price);
}
async function body(request:Request) { if(Number(request.headers.get('Content-Length'))>12000)throw new Error('Request too large');const text=await request.text();if(text.length>12000)throw new Error('Request too large');return JSON.parse(text) as Record<string,unknown>; }
export async function handle(request:Request,env:Env,clientCode:string):Promise<Response> {
 const url=new URL(request.url);const path=url.pathname;const method=request.method;
 const user=request.headers.get('oai-authenticated-user-id');const email=request.headers.get('oai-authenticated-user-email');
 if(path==='/style.css')return new Response(css,{headers:{'Content-Type':'text/css','Cache-Control':'public,max-age=300'}});
 if(path==='/app.js')return new Response(clientCode,{headers:{'Content-Type':'text/javascript','Cache-Control':'public,max-age=300'}});
 if(path==='/api/internal/scan'&&method==='POST'){
  const key=request.headers.get('Authorization');
  if(env.SITE_ACCESS!=='private' && (!env.SCAN_SECRET||key!==`Bearer ${env.SCAN_SECRET}`))return json({error:'Scan authorization required'},401);
  return json(await scan(env));
 }
 if(path==='/unsubscribe'){
  const token=url.searchParams.get('token');if(!token||token.length>100)return new Response('Invalid link',{status:400});
  if(method==='POST'){await env.DB.prepare('DELETE FROM watches WHERE unsubscribe_token=?').bind(token).run();return new Response('<p>Your watch has been removed. <a href="/">Back to Shoe Watch</a></p>',{headers:{'Content-Type':'text/html'}});}
  return new Response('<!doctype html><meta name="viewport" content="width=device-width"><title>Stop your shoe watch</title><body style="font:18px system-ui;background:#f3f3e9;color:#213b2e;padding:10vw"><h1>Ready to stop this watch?</h1><p>You can create another whenever you like.</p><form method="post"><button style="padding:16px 24px">Stop this watch</button></form></body>',{headers:{'Content-Type':'text/html','Referrer-Policy':'no-referrer'}});
 }
 if(path.startsWith('/api/')){
  if(method!=='GET' && request.headers.get('Origin') && request.headers.get('Origin')!==url.origin)return json({error:'Origin mismatch'},403);
  if(path==='/api/dashboard'&&method==='GET'){
   await initializeSources(env);
   const [rows,sourceRows,last,watches]=await Promise.all([
    env.DB.prepare('SELECT * FROM offers WHERE available=1 AND checked_at>=? ORDER BY checked_at DESC LIMIT 20000').bind(freshCutoff()).all<Offer>(),
    env.DB.prepare('SELECT * FROM sources ORDER BY CASE adapter WHEN \'planned\' THEN 1 ELSE 0 END,name').all(),
    env.DB.prepare("SELECT value FROM app_state WHERE key='last_scan'").first<{value:string}>(),
    user?env.DB.prepare('SELECT id,kind,query,category,fit,size_system,size,colour,budget,min_discount,active,created_at FROM watches WHERE owner_id=? ORDER BY created_at DESC').bind(user).all<Watch>():Promise.resolve({results:[] as Watch[]})
   ]);
   return json({offers:groupOffers(rows.results),sources:sourceRows.results,lastScan:last?.value??null,watches:watches.results.map(w=>({...w,matchCount:rows.results.filter(o=>matches(w,o)).length})),user:user?{email:email??'',signedIn:true}:null,emailReady:!!(env.RESEND_API_KEY&&env.EMAIL_FROM&&env.APP_URL)});
  }
  if(!user||!email)return json({error:'Please sign in to save a watch'},401);
  if(path==='/api/watches'&&method==='POST'){
   const data=await body(request);const kind=String(data.kind),query=String(data.query??'').trim(),category=String(data.category??'any'),fit=String(data.fit),size=String(data.size),budget=Number(data.budget),min=Number(data.min_discount??25);
   if(!['category','brand','model'].includes(kind)||!categories.includes(category as typeof categories[number])||!['men','women','any'].includes(fit)||!/^\d{1,2}(\.5)?$/.test(size)||Number(size)<2||Number(size)>15||!Number.isFinite(budget)||budget<3000||budget>50000||!Number.isInteger(budget)||![20,25,30,40].includes(min)||query.length>100||(kind!=='category'&&!query))return json({error:'Check your shoe, size and budget'},400);
   if(data.consent!==true)return json({error:'Please agree to email alerts for this watch'},400);
   const count=await env.DB.prepare('SELECT count(*) AS n FROM watches WHERE owner_id=?').bind(user).first<{n:number}>();if((count?.n??0)>=10)return json({error:'You can keep up to 10 watches. Remove one to add another.'},400);
   const id=crypto.randomUUID(),now=new Date().toISOString();
   await env.DB.prepare('INSERT INTO watches(id,owner_id,email,kind,query,category,fit,size_system,size,colour,budget,min_discount,created_at,consent_at,unsubscribe_token) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,user,email,kind,query,category,fit,'UK',String(Number(size)),String(data.colour??'').trim().slice(0,60),budget,min,now,now,crypto.randomUUID()).run();return json({id},201);
  }
  const match=path.match(/^\/api\/watches\/([a-f0-9-]{36})$/);
  if(match&&method==='DELETE'){await env.DB.prepare('DELETE FROM watches WHERE id=? AND owner_id=?').bind(match[1],user).run();return json({ok:true});}
  if(match&&method==='PATCH'){const data=await body(request);if(typeof data.active!=='boolean')return json({error:'Invalid state'},400);await env.DB.prepare('UPDATE watches SET active=? WHERE id=? AND owner_id=?').bind(data.active?1:0,match[1],user).run();return json({ok:true});}
  if(path==='/api/feedback'&&method==='POST'){
   const data=await body(request);const message=String(data.message??'').trim(),kind=String(data.kind??'idea');
   if(message.length<5||message.length>2000||!['idea','source','issue'].includes(kind))return json({error:'Write between 5 and 2,000 characters'},400);
   const recent=await env.DB.prepare('SELECT count(*) AS n FROM feedback WHERE owner_id=? AND created_at>?').bind(user,new Date(Date.now()-3600000).toISOString()).first<{n:number}>();if((recent?.n??0)>=5)return json({error:'Thanks for the ideas. Try again in an hour.'},429);
   await env.DB.prepare('INSERT INTO feedback VALUES(?,?,?,?,?)').bind(crypto.randomUUID(),user,kind,message,new Date().toISOString()).run();return json({ok:true},201);
  }
  return json({error:'Not found'},404);
 }
 if(path==='/'&&method==='GET')return new Response(html as unknown as string,{headers:{'Content-Type':'text/html','Cache-Control':'no-store','X-Content-Type-Options':'nosniff','Referrer-Policy':'strict-origin-when-cross-origin','Content-Security-Policy':"default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' https://cdn.shopify.com data:; font-src 'self'; connect-src 'self'; frame-ancestors 'self'; base-uri 'none'; form-action 'self'"}});
 return new Response('Not found',{status:404});
}
