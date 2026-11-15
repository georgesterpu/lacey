import { describe, test, expect, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { handle } from '../src/server';
import { matches, discount, type Env, type Offer, type Watch, type Statement } from '../src/types';
import { normalize, sources } from '../src/sources';
import { sendConfirmation } from '../src/email';
import { claim } from '../src/identity';
import { shopLocation } from '../src/shops';
const now=new Date().toISOString();
const offer:Offer={id:'amphibian:1',source_id:'amphibian',product_id:'p1',title:'ASICS Gel Kayano 31 Mens',brand:'ASICS',category:'stability',fit:'men',size_system:'UK',size:'9',colour:'Black',price:10000,reference_price:16000,currency:'EUR',image:'',url:'https://www.amphibianking.ie/products/test',available:1,checked_at:now};
const watch:Watch={id:'w1',owner_id:'a',email:'a@example.test',kind:'model',query:'Kayano 31',category:'any',fit:'men',size_system:'UK',size:'9',colour:'',budget:12000,min_discount:25,active:1,created_at:now,consent_at:now};
describe('Alert eligibility',()=>{
 test('requires matching model generation, in-stock size, fit, freshness and budget',()=>{expect(matches(watch,offer)).toBe(true);for(const change of [{title:'ASICS Gel Kayano 32 Mens'},{size:'9.5'},{fit:'women'},{size_system:'unknown'},{available:0},{checked_at:'2020-01-01T00:00:00Z'},{price:13000},{reference_price:null}])expect(matches(watch,{...offer,...change})).toBe(false);});
 test('does not mistake partial model names or small markdowns for a match',()=>{expect(matches({...watch,query:'Kayano 3'},offer)).toBe(false);expect(discount({...offer,reference_price:10000})).toBe(0);expect(matches({...watch,min_discount:40},offer)).toBe(false);});
 test('broad watches match only the selected category or brand',()=>{expect(matches({...watch,kind:'category',category:'stability'},offer)).toBe(true);expect(matches({...watch,kind:'category',category:'trail'},offer)).toBe(false);expect(matches({...watch,kind:'brand',query:'hoka'},offer)).toBe(false);});
});
test('adult shoes survive negative merchandising tags; ambiguous sizes stay unconfirmed',()=>{
 const p={id:1,title:'Nike Road Running Shoes Mens',vendor:'Nike',product_type:'Running Shoe',tags:['e:kids-personalisation-available:false'],handle:'test',options:[{name:'Size',position:1}],images:[],variants:[{id:2,price:'80',compare_at_price:'100',available:true,option1:'9',option2:null,option3:null}]};
 const rows=normalize(p,sources[2],now);expect(rows).toHaveLength(1);expect(rows[0].size_system).toBe('unknown');expect(rows[0].price).toBe(8000);expect(normalize({...p,title:'Nike Junior Road Running Shoes'},sources[2],now)[0].fit).toBe('kids');
});
const connections:Database[]=[];afterEach(()=>{connections.splice(0).forEach(d=>d.close());});
async function database(){const sqlite=new Database(':memory:');connections.push(sqlite);sqlite.exec('PRAGMA foreign_keys=ON');const journal=await Bun.file('drizzle/meta/_journal.json').json();for(const {tag} of journal.entries)sqlite.exec(await Bun.file(`drizzle/${tag}.sql`).text());function stmt(sql:string,args:unknown[]=[]):Statement{return {bind:(...v)=>stmt(sql,v),all:async<T>()=>({results:sqlite.query(sql).all(...args as any[]) as T[]}),first:async<T>()=>(sqlite.query(sql).get(...args as any[])??null) as T|null,run:async()=>sqlite.query(sql).run(...args as any[])}}return {DB:{prepare:(s:string)=>stmt(s),batch:async(s:Statement[])=>{for(const q of s)await q.run();return [];}},SITE_ACCESS:'public'} as Env;}
function request(path:string,method='GET',owner?:string,body?:unknown,extra:Record<string,string>={}){return new Request(`https://shoe.test${path}`,{method,headers:{'Content-Type':'application/json',...(owner?{'Cookie':`brave_device=${Buffer.from(owner).toString('hex').padEnd(64,'0')}`} :{}),...extra},body:body?JSON.stringify(body):undefined});}
const watchInput={kind:'category',category:'daily',fit:'men',size:'9',budget:12000,min_discount:25,consent:true,email:'runner@example.test'};
test('account-free watches persist privately by device and never expose addresses',async()=>{
 const env=await database();expect((await handle(request('/api/watches','POST',undefined,watchInput),env,'')).status).toBe(401);
 const response=await handle(request('/api/watches','POST','alice',{...watchInput,email:'someone-else@example.test'}),env,'');expect(response.status).toBe(201);const {id}=await response.json();
 expect((await env.DB.prepare('SELECT email_verified FROM watches').first<{email_verified:number}>())?.email_verified).toBe(0);
 await handle(request(`/api/watches/${id}`,'DELETE','bob'),env,'');expect((await env.DB.prepare('SELECT id FROM watches').all()).results).toHaveLength(1);
 const bob=await (await handle(request('/api/dashboard','GET','bob'),env,'')).json();expect(bob.watches).toHaveLength(0);expect(bob.emailReady).toBe(false);
 await handle(request(`/api/watches/${id}`,'PATCH','alice',{active:false}),env,'');expect((await env.DB.prepare('SELECT active FROM watches').first<{active:number}>())?.active).toBe(0);
 await handle(request(`/api/watches/${id}`,'DELETE','alice'),env,'');expect((await env.DB.prepare('SELECT id FROM watches').all()).results).toHaveLength(0);
});
test('validation, consent and origin checks on public forms',async()=>{
 const env=await database();for(const input of [{...watchInput,consent:false},{...watchInput,budget:-100},{...watchInput,size:'99'},{...watchInput,kind:'invented'}])expect((await handle(request('/api/watches','POST','alice',input),env,'')).status).toBe(400);
 expect((await handle(request('/api/watches','POST','alice',watchInput,{Origin:'https://evil.test'}),env,'')).status).toBe(403);
 expect((await handle(request('/api/watches','POST','alice',{...watchInput,email:'invalid'}),env,'')).status).toBe(400);
 const dashboard=await handle(request('/api/dashboard'),env,'');expect(dashboard.status).toBe(200);const cookie=dashboard.headers.get('Set-Cookie')!;expect(cookie).toContain('HttpOnly');expect(cookie).toContain('SameSite=Lax');expect(cookie).toContain('Secure');expect(cookie).toMatch(/brave_device=[a-f0-9]{64}/);
});
test('unsubscribe GET confirms and POST removes the watch and its alert history',async()=>{
 const env=await database();const {id}=await (await handle(request('/api/watches','POST','alice',watchInput),env,'')).json();const row=await env.DB.prepare('SELECT unsubscribe_token FROM watches WHERE id=?').bind(id).first<{unsubscribe_token:string}>();
 await env.DB.prepare('INSERT INTO notifications(id,watch_id,offer_id,price,created_at) VALUES(?,?,?,?,?)').bind('n',id,'o',10000,now).run();
 expect((await handle(request(`/unsubscribe?token=${row!.unsubscribe_token}`),env,'')).status).toBe(200);expect((await env.DB.prepare('SELECT id FROM watches').all()).results).toHaveLength(1);
 await handle(request(`/unsubscribe?token=${row!.unsubscribe_token}`,'POST'),env,'');expect((await env.DB.prepare('SELECT id FROM watches').all()).results).toHaveLength(0);expect((await env.DB.prepare('SELECT id FROM notifications').all()).results).toHaveLength(0);
});

test('shop flags distinguish European retailers from Irish storefronts',()=>{
 for(const id of ['misterrunning','warehouse','21run'])expect(shopLocation(id)).toEqual({region:'EU',flag:'🇪🇺',label:'EU shop'});
 for(const id of ['amphibian','runhub','elverys','lifestyle','sportsdirect'])expect(shopLocation(id)).toEqual({region:'IE',flag:'🇮🇪',label:'Irish shop'});
});
test('public dashboard ignores forged account headers and never returns other-device watches',async()=>{
 const env=await database();await handle(request('/api/watches','POST','alice',watchInput),env,'');
 const guest=await (await handle(request('/api/dashboard','GET',undefined,undefined,{'oai-authenticated-user-id':'alice','oai-authenticated-user-email':watchInput.email}),env,'')).json();
 expect(guest.watches).toHaveLength(0);expect(JSON.stringify(guest)).not.toContain(watchInput.email);
 const alice=await (await handle(request('/api/dashboard','GET','alice'),env,'')).json();expect(alice.watches).toHaveLength(1);expect(JSON.stringify(alice.watches)).not.toContain(watchInput.email);
});
test('a confirmation GET cannot opt someone in; POST verifies only that device’s email',async()=>{
 const env=await database();
 const first=await (await handle(request('/api/watches','POST','alice',{...watchInput,kind:'model',query:'Kayano 31'}),env,'')).json();
 await handle(request('/api/watches','POST','bob',watchInput),env,'');
 env.RESEND_API_KEY='test-only';env.EMAIL_FROM='test@example.test';env.APP_URL='https://shoe.test';
 const original=globalThis.fetch;const messages:Record<string,string>[]=[];
 globalThis.fetch=(async (_url:unknown,init:RequestInit)=>{messages.push(JSON.parse(String(init.body)));return Response.json({id:'test-only'});}) as typeof fetch;
 try{
  const result=await sendConfirmation(env,{id:first.id,email:watchInput.email});expect(result).toBe('sent');expect(messages).toHaveLength(1);expect(messages[0].subject).toBe('One little click for happy feet 😊 — Lacey');
  const token=messages[0].text.match(/confirm-email\?token=([a-f0-9]{64})/)![1];
  await handle(request(`/confirm-email?token=${token}`),env,'');expect((await env.DB.prepare('SELECT count(*) n FROM watches WHERE email_verified=1').first<{n:number}>())!.n).toBe(0);
  await handle(request(`/confirm-email?token=${token}`,'POST'),env,'');expect((await env.DB.prepare('SELECT count(*) n FROM watches WHERE email_verified=1').first<{n:number}>())!.n).toBe(1);
  expect((await env.DB.prepare('SELECT email_verified FROM watches WHERE id=?').bind(first.id).first<{email_verified:number}>())!.email_verified).toBe(1);
 }finally{globalThis.fetch=original;}
});
test('scheduler requires its own secret, and failures admit only three attempts',async()=>{
 const env=await database();env.CRON_SECRET='test-only';expect((await Promise.all(Array.from({length:6},()=>claim(env,'one-claim')))).filter(Boolean)).toHaveLength(1);
 expect((await handle(request('/api/internal/scan','POST'),env,'')).status).toBe(401);
 const original=globalThis.fetch;let calls=0;
 globalThis.fetch=(async()=>{calls++;return new Response('Temporary source failure',{status:503});}) as unknown as typeof fetch;
 try{for(let n=0;n<3;n++){const r=await(await handle(request('/api/internal/scan','POST',undefined,undefined,{Authorization:'Bearer test-only'}),env,'')).json();expect(r.status).toBe('failed');}expect(calls).toBe(9);const last=await(await handle(request('/api/internal/scan','POST',undefined,undefined,{Authorization:'Bearer test-only'}),env,'')).json();expect(last.skipped).toBe(true);expect(calls).toBe(9);}finally{globalThis.fetch=original;}
});
