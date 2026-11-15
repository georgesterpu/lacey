import { describe, test, expect, afterEach } from 'bun:test';
import { Database } from 'bun:sqlite';
import { handle } from '../src/server';
import { matches, discount, type Env, type Offer, type Watch, type Statement } from '../src/types';
import { normalize, sources } from '../src/sources';
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
 const rows=normalize(p,sources[2],now);expect(rows).toHaveLength(1);expect(rows[0].size_system).toBe('unknown');expect(rows[0].price).toBe(8000);expect(normalize({...p,title:'Nike Junior Road Running Shoes'},sources[2],now)).toHaveLength(0);
});
const connections:Database[]=[];afterEach(()=>{connections.splice(0).forEach(d=>d.close());});
async function database(){const sqlite=new Database(':memory:');connections.push(sqlite);sqlite.exec('PRAGMA foreign_keys=ON');sqlite.exec(await Bun.file('drizzle/0000_initial.sql').text());function stmt(sql:string,args:unknown[]=[]):Statement{return {bind:(...v)=>stmt(sql,v),all:async<T>()=>({results:sqlite.query(sql).all(...args as any[]) as T[]}),first:async<T>()=>(sqlite.query(sql).get(...args as any[])??null) as T|null,run:async()=>sqlite.query(sql).run(...args as any[])}}return {DB:{prepare:(s:string)=>stmt(s),batch:async(s:Statement[])=>{for(const q of s)await q.run();return [];}},SITE_ACCESS:'public'} as Env;}
function request(path:string,method='GET',owner?:string,body?:unknown,extra:Record<string,string>={}){return new Request(`https://shoe.test${path}`,{method,headers:{'Content-Type':'application/json',...(owner?{'oai-authenticated-user-id':owner,'oai-authenticated-user-email':`${owner}@example.test`}:{}),...extra},body:body?JSON.stringify(body):undefined});}
const watchInput={kind:'category',category:'daily',fit:'men',size:'9',budget:12000,min_discount:25,consent:true};
test('watch lifecycle persists and is isolated by owner, including email ownership',async()=>{
 const env=await database();expect((await handle(request('/api/watches','POST',undefined,watchInput),env,'')).status).toBe(401);
 const response=await handle(request('/api/watches','POST','alice',{...watchInput,email:'someone-else@example.test'}),env,'');expect(response.status).toBe(201);const {id}=await response.json();
 expect((await env.DB.prepare('SELECT email FROM watches').first<{email:string}>())?.email).toBe('alice@example.test');
 await handle(request(`/api/watches/${id}`,'DELETE','bob'),env,'');expect((await env.DB.prepare('SELECT id FROM watches').all()).results).toHaveLength(1);
 const bob=await (await handle(request('/api/dashboard','GET','bob'),env,'')).json();expect(bob.watches).toHaveLength(0);expect(bob.emailReady).toBe(false);
 await handle(request(`/api/watches/${id}`,'PATCH','alice',{active:false}),env,'');expect((await env.DB.prepare('SELECT active FROM watches').first<{active:number}>())?.active).toBe(0);
 await handle(request(`/api/watches/${id}`,'DELETE','alice'),env,'');expect((await env.DB.prepare('SELECT id FROM watches').all()).results).toHaveLength(0);
});
test('validation, consent, origin checks and public scan protection',async()=>{
 const env=await database();for(const input of [{...watchInput,consent:false},{...watchInput,budget:-100},{...watchInput,size:'99'},{...watchInput,kind:'invented'}])expect((await handle(request('/api/watches','POST','alice',input),env,'')).status).toBe(400);
 expect((await handle(request('/api/watches','POST','alice',watchInput,{Origin:'https://evil.test'}),env,'')).status).toBe(403);
 expect((await handle(request('/api/internal/scan','POST'),env,'')).status).toBe(401);
});
test('unsubscribe GET confirms and POST removes the watch and its alert history',async()=>{
 const env=await database();const {id}=await (await handle(request('/api/watches','POST','alice',watchInput),env,'')).json();const row=await env.DB.prepare('SELECT unsubscribe_token FROM watches WHERE id=?').bind(id).first<{unsubscribe_token:string}>();
 await env.DB.prepare('INSERT INTO notifications(id,watch_id,offer_id,price,created_at) VALUES(?,?,?,?,?)').bind('n',id,'o',10000,now).run();
 expect((await handle(request(`/unsubscribe?token=${row!.unsubscribe_token}`),env,'')).status).toBe(200);expect((await env.DB.prepare('SELECT id FROM watches').all()).results).toHaveLength(1);
 await handle(request(`/unsubscribe?token=${row!.unsubscribe_token}`,'POST'),env,'');expect((await env.DB.prepare('SELECT id FROM watches').all()).results).toHaveLength(0);expect((await env.DB.prepare('SELECT id FROM notifications').all()).results).toHaveLength(0);
});
