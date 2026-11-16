import {test,expect,afterEach} from 'bun:test';
import {Database} from 'bun:sqlite';
import {normalize,cents,sources,type Product} from '../src/sources';
import {scan,initializeSources} from '../src/scan';
import {planDigests,dispatchDigests} from '../src/outbox';
import {validateProduct,sameVerifiedOffer} from '../src/validation';
import {digestEmail} from '../src/email-template';
import {scheduleSlot,nextCheck} from '../src/schedule';
import {currentDeals} from '../src/catalogue';
import {cleanup} from '../src/retention';
import {handle} from '../src/server';
import{prepareDelivery}from '../src/preflight';
import {matches,type Env,type Statement,type Offer,type Watch} from '../src/types';
const open:Database[]=[];const originalFetch=globalThis.fetch;afterEach(()=>{globalThis.fetch=originalFetch;open.splice(0).forEach(d=>d.close());});
test('the trusted worker checks stock once and the email server consumes its fresh verification without contacting retailers',async()=>{
 const {env}=await database(),p=product(901),run=await runWithOffers(env,[p]);await watch(env,'worker-preflight','runner@example.test');
 const messages:any[]=[];const fake=fakeShop([p],messages);await planDigests(env,run.id);env.REQUIRE_PREFLIGHT=true;
 expect((await dispatchDigests(env,run.id)).status).toBe('awaiting_verification');expect(fake.counts()).toEqual({heads:0,products:0});expect(messages).toHaveLength(0);
 expect((await prepareDelivery({...env,REQUIRE_PREFLIGHT:false},run.id)).checked).toBe(1);expect(fake.counts()).toEqual({heads:1,products:1});
 const send=globalThis.fetch;globalThis.fetch=(async(input,init)=>{if(String(input)!=='https://api.resend.com/emails')throw Error('The email server must not contact the retailer');return send(input,init);}) as typeof fetch;
 expect((await dispatchDigests(env,run.id)).sent).toBe(1);expect(messages).toHaveLength(1);
});
async function database(){const db=new Database(':memory:');open.push(db);db.exec('PRAGMA foreign_keys=ON');const journal=await Bun.file('drizzle/meta/_journal.json').json();for(const {tag} of journal.entries)db.exec(await Bun.file(`drizzle/${tag}.sql`).text());function statement(sql:string,args:unknown[]=[]):Statement{return {bind:(...v)=>statement(sql,v),all:async<T>()=>({results:db.query(sql).all(...args as any[]) as T[]}),first:async<T>()=>(db.query(sql).get(...args as any[])??null) as T|null,run:async()=>db.query(sql).run(...args as any[])}}let queued:Promise<unknown>=Promise.resolve();const env:Env={DB:{prepare:sql=>statement(sql),batch:statements=>{const operation=queued.then(async()=>{db.exec('BEGIN');try{const result=[];for(const s of statements)result.push(await s.run());db.exec('COMMIT');return result;}catch(e){db.exec('ROLLBACK');throw e;}});queued=operation.catch(()=>{});return operation;}},RESEND_API_KEY:'test-only',EMAIL_FROM:'test@example.test',APP_URL:'https://shoe.test',CRON_SECRET:'test-only'};await initializeSources(env);return {env,db};}
function product(id=100,size='9',price='100.00'):Product{return {id,title:`ASICS Gel Kayano ${id} Mens`,vendor:'ASICS',handle:`kayano-${id}`,tags:['Running','stability'],product_type:'Men’s Running Shoes',options:[{name:'Size',position:1}],images:[{src:'https://cdn.shopify.com/example.jpg'}],variants:[{id:id*10+1,option1:`UK ${size}`,option2:null,option3:null,price,compare_at_price:'160.00',available:true}]};}
function js(p:Product){return {...p,type:p.product_type,variants:p.variants.map(v=>({...v,price:cents(v.price),compare_at_price:cents(v.compare_at_price)}))};}
async function runWithOffers(env:Env,ps:Product[]){const id=crypto.randomUUID(),now=new Date().toISOString();await env.DB.prepare("INSERT INTO scan_runs(id,slot_key,status,started_at,heartbeat_at,completed_at) VALUES(?,?,'complete',?,?,?)").bind(id,`${id}:08`,now,now,now).run();const rows=ps.flatMap(p=>normalize(p,sources[0],now));const snapshot=`${id}:amphibian`;for(const o of rows)await env.DB.prepare('INSERT INTO offer_snapshots VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(snapshot,id,o.id,o.source_id,o.product_id,o.title,o.brand,o.category,o.fit,o.size_system,o.size,o.colour,o.price,o.reference_price,o.currency,o.image,o.url,o.available,now).run();await env.DB.prepare("UPDATE sources SET live_snapshot_id=?,last_success=?,status='live' WHERE id=?").bind(snapshot,now,'amphibian').run();return {id,rows};}
async function watch(env:Env,id:string,email:string,size='9',fit='men',verified=1){const now=new Date().toISOString();await env.DB.prepare('INSERT INTO watches(id,owner_id,email,kind,query,category,fit,size_system,size,colour,budget,min_discount,active,created_at,consent_at,unsubscribe_token,email_verified) VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(id,id,email,'category','','any',fit,'UK',size,'',14000,25,1,now,now,crypto.randomUUID(),verified).run();}
function fakeShop(ps:Product[],messages:any[],options:{badLink?:boolean;changedPrice?:boolean;failEmail?:boolean}={}){let heads=0,products=0;globalThis.fetch=(async(input:unknown,init?:RequestInit)=>{const url=String(input);if(url==='https://api.resend.com/emails'){messages.push(JSON.parse(String(init?.body)));return options.failEmail?new Response('Busy',{status:429}):Response.json({id:`test-${messages.length}`});}if(init?.method==='HEAD'){heads++;return new Response('',{status:options.badLink?404:200});}if(url.endsWith('.js')){products++;const p=ps.find(p=>url.includes(p.handle))!;const data=js(p);if(options.changedPrice)data.variants[0].price=11000;return Response.json(data);}throw new Error(`Unexpected URL ${url}`);}) as typeof fetch;return {counts:()=>({heads,products})};}

test('real adult and kids fixtures parse with units preserved and strict prices',async()=>{const adult=await Bun.file('fixtures/amphibian-adult.json').json(),kids=await Bun.file('fixtures/elverys-kids.json').json();expect(normalize(adult,sources[0],new Date().toISOString())[0].fit).toBe('men');const child=normalize(kids,sources[2],new Date().toISOString())[0];expect(child.fit).toBe('kids');expect(child.size_system).toBe('unknown');for(const bad of ['1,000.00','12.999','-2','NaN',100])expect(cents(bad)).toBeNull();expect(cents('12.30')).toBe(1230);expect(normalize({...product(),variants:[{...product().variants[0],available:'true' as any}]},sources[0],new Date().toISOString())).toHaveLength(0);});
test('kids never match adult watches; shop-size matching is explicit and source-bound',()=>{const o=normalize(product(),sources[0],new Date().toISOString())[0];const w={...o,id:'w',owner_id:'d',email:'a@example.test',kind:'category',query:'',category:'any',fit:'any',budget:12000,min_discount:25,active:1,created_at:o.checked_at,consent_at:o.checked_at} as Watch;expect(matches(w,{...o,fit:'kids'})).toBe(false);expect(matches({...w,fit:'kids'},o)).toBe(false);expect(matches({...w,fit:'kids'},{...o,fit:'kids'})).toBe(true);expect(matches({...w,kind:'model',query:'Kayano',size_system:'STORE:elverys'},{...o,source_id:'elverys',size_system:'unknown'})).toBe(true);expect(matches({...w,kind:'model',query:'Kayano',size_system:'STORE:elverys'},{...o,size_system:'unknown'})).toBe(false);});
test('Dublin slots and next checks stay aligned across summer time',()=>{expect(scheduleSlot(new Date('2026-07-01T07:05:00Z'))).toBe('2026-07-01:08');expect(scheduleSlot(new Date('2026-12-01T08:05:00Z'))).toBe('2026-12-01:08');expect(scheduleSlot(new Date('2026-07-01T06:30:00Z'))).toBe('2026-06-30:20');expect(nextCheck(new Date('2026-07-01T06:30:00Z'))).toBe('2026-07-01T07:00:00.000Z');});
test('contract failure leaves the last good source snapshot untouched',async()=>{const {env}=await database(),old=await runWithOffers(env,[product(99)]);globalThis.fetch=(async()=>Response.json({products:[{title:'Schema changed'}]})) as unknown as typeof fetch;const result=await scan(env);expect(result.status).toBe('failed');const visible=(await env.DB.prepare('SELECT id FROM current_offers').all<{id:string}>()).results;expect(visible.map(o=>o.id)).toEqual(old.rows.map(o=>o.id));expect((await env.DB.prepare('SELECT status FROM sources WHERE id=?').bind('amphibian').first<{status:string}>())!.status).toBe('error');});
test('an interrupted snapshot write is never published',async()=>{const {env}=await database(),old=await runWithOffers(env,[product(99)]);const p=product(101);p.variants=Array.from({length:61},(_,i)=>({...p.variants[0],id:10000+i}));globalThis.fetch=(async(input:unknown)=>String(input).includes('amphibianking')?Response.json({products:[p]}):new Response('Unavailable',{status:503})) as typeof fetch;const batch=env.DB.batch;let n=0;env.DB.batch=async statements=>{n++;if(n===3)throw new Error('Simulated write interruption');return batch(statements);};await scan(env);expect((await env.DB.prepare('SELECT id FROM current_offers').all<{id:string}>()).results.map(o=>o.id)).toEqual(old.rows.map(o=>o.id));});
test('multiple watches become one digest; product validation is shared across subscribers',async()=>{const {env}=await database(),ps=[product(101),product(102)],run=await runWithOffers(env,ps);await watch(env,'w1','one@example.test');await watch(env,'w2','one@example.test');await watch(env,'w3','two@example.test');const messages:any[]=[],network=fakeShop(ps,messages);const plan=await planDigests(env,run.id);expect(plan.planned).toBe(2);const delivery=await dispatchDigests(env,run.id,5);expect(delivery.sent).toBe(2);expect(messages).toHaveLength(2);for(const m of messages){expect(m.html).toContain(ps[0].title);expect(m.html).toContain(ps[1].title);expect(m.html).toContain('variant=1011');expect(m.html).toContain('variant=1021');expect(m.text).toContain('Stop sale emails');}expect(network.counts()).toEqual({heads:2,products:2});await planDigests(env,run.id);expect((await dispatchDigests(env,run.id,5)).sent).toBe(0);expect(messages).toHaveLength(2);});
test('failed links and changed prices are suppressed before sending',async()=>{for(const options of [{badLink:true},{changedPrice:true}]){const {env}=await database(),ps=[product(105)],run=await runWithOffers(env,ps);await watch(env,'w','one@example.test');const messages:any[]=[];fakeShop(ps,messages,options);await planDigests(env,run.id);const result=await dispatchDigests(env,run.id,5);expect(result.sent).toBe(0);expect(messages).toHaveLength(0);expect((await env.DB.prepare('SELECT status FROM digest_jobs').first<{status:string}>())!.status).toBe('suppressed');}});
test('unverified, paused, and unsubscribed watches cannot receive a digest',async()=>{const {env}=await database(),ps=[product(106)],run=await runWithOffers(env,ps);await watch(env,'unconfirmed','one@example.test','9','men',0);expect((await planDigests(env,run.id)).planned).toBe(0);await env.DB.prepare('UPDATE scan_runs SET planning_done=0,cursor_email=? WHERE id=?').bind('',run.id).run();await env.DB.prepare('UPDATE watches SET email_verified=1').run();await planDigests(env,run.id);await env.DB.prepare('UPDATE watches SET active=0').run();const messages:any[]=[];fakeShop(ps,messages);expect((await dispatchDigests(env,run.id,5)).sent).toBe(0);expect(messages).toHaveLength(0);});
test('email budget is enforced globally across recipients',async()=>{const {env}=await database();env.DAILY_EMAIL_LIMIT='1';const ps=[product(108)],run=await runWithOffers(env,ps);await watch(env,'w1','one@example.test');await watch(env,'w2','two@example.test');const messages:any[]=[];fakeShop(ps,messages);await planDigests(env,run.id);const result=await dispatchDigests(env,run.id,5);expect(result.sent).toBe(1);expect(result.status).toBe('daily_limit');expect(messages).toHaveLength(1);});
test('provider failure is stored for retry and never marked sent',async()=>{const {env}=await database(),ps=[product(109)],run=await runWithOffers(env,ps);await watch(env,'w','one@example.test');const messages:any[]=[];fakeShop(ps,messages,{failEmail:true});await planDigests(env,run.id);expect((await dispatchDigests(env,run.id,5)).sent).toBe(0);const job=await env.DB.prepare('SELECT status,attempts,payload FROM digest_jobs').first<{status:string;attempts:number;payload:string}>();expect(job!.status).toBe('queued');expect(job!.attempts).toBe(1);expect(job!.payload).toContain('Lacey');});
test('email rendering escapes content and keeps direct retailer URLs',()=>{const offer=normalize(product(),sources[0],new Date().toISOString())[0];const rendered=digestEmail([{...offer,title:'<script>alert(1)</script>'}], 'https://shoe.test','https://shoe.test/unsubscribe-all?token=test');expect(rendered.html).not.toContain('<script>');expect(rendered.html).toContain('&lt;script&gt;');expect(rendered.html).toContain(offer.url.replace(/&/g,'&amp;'));expect(rendered.html).toContain('🇮🇪');});

test('recipient lookup uses the composite size index instead of a full run scan',async()=>{const {db}=await database();const plan=db.query("EXPLAIN QUERY PLAN SELECT o.* FROM offer_snapshots o JOIN sources s ON s.id=o.source_id AND s.live_snapshot_id=o.snapshot_id WHERE o.checked_at>=? AND o.size_system=? AND o.size=? AND o.available=1 AND o.price<=?").all(new Date().toISOString(),'UK','9',12000) as {detail:string}[];expect(plan.some(p=>p.detail.includes('snapshot_matching'))).toBe(true);});

test('ended discounts, unavailable products and vanished products leave the public deals',async()=>{
 const {env}=await database();const p=product(121);await runWithOffers(env,[p]);expect(await currentDeals(env)).toHaveLength(1);
 await runWithOffers(env,[{...p,variants:[{...p.variants[0],price:'160.00'}]}]);expect(await currentDeals(env)).toHaveLength(0);
 await runWithOffers(env,[{...p,variants:[{...p.variants[0],available:false}]}]);expect(await currentDeals(env)).toHaveLength(0);
 const replacement=await runWithOffers(env,[product(122)]);expect((await currentDeals(env)).map(o=>o.id)).toEqual(replacement.rows.map(o=>o.id));
 expect((await env.DB.prepare('SELECT count(*) n FROM offer_snapshots').first<{n:number}>())!.n).toBeGreaterThan(1);
});
test('a failed source, known dead page or freshly changed price cannot remain a public deal',async()=>{
 for(const mode of ['source','link','price']){const {env}=await database(),p=product(123),run=await runWithOffers(env,[p]);expect(await currentDeals(env)).toHaveLength(1);
  if(mode==='source')await env.DB.prepare("UPDATE sources SET status='error' WHERE id='amphibian'").run();else{fakeShop([p],[],{badLink:mode==='link',changedPrice:mode==='price'});await validateProduct(env,run.id,run.rows[0]);}
  expect(await currentDeals(env)).toHaveLength(0);
 }
});
test('housekeeping bounds old shoes and run records while preserving live shoes and watches',async()=>{
 const {env,db}=await database(),old=await runWithOffers(env,[product(124)]),live=await runWithOffers(env,[product(125)]),oldTime=new Date(Date.now()-100*86400000).toISOString();
 await watch(env,'keep-watch','member@example.test');
 await env.DB.prepare('UPDATE offer_snapshots SET checked_at=? WHERE run_id=?').bind(oldTime,old.id).run();
 await env.DB.prepare('UPDATE scan_runs SET started_at=?,completed_at=? WHERE id=?').bind(oldTime,oldTime,old.id).run();
 await env.DB.prepare("INSERT INTO source_runs(run_id,source_id,status) VALUES(?,'amphibian','complete')").bind(old.id).run();
 const o=old.rows[0];await env.DB.prepare('INSERT INTO offers VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(o.id,o.source_id,o.product_id,o.title,o.brand,o.category,o.fit,o.size_system,o.size,o.colour,o.price,o.reference_price,o.currency,o.image,o.url,o.available,oldTime).run();
 await env.DB.prepare('INSERT INTO price_history VALUES(?,?,?)').bind(o.id,10000,oldTime).run();
 const oldHour=oldTime.slice(0,13),newHour=new Date().toISOString().slice(0,13),hash='a'.repeat(64);
 for(const action of ['watch','feedback'])for(const time of [oldHour,newHour])await env.DB.prepare('INSERT INTO app_state VALUES(?,?)').bind(`rate:${action}:${hash}:${time}:0`,'claim').run();
 await env.DB.prepare("INSERT INTO app_state VALUES('last_scan',?)").bind(new Date().toISOString()).run();
 await env.DB.prepare('INSERT INTO email_confirmations VALUES(?,?,?,?)').bind('keep-watch','token',oldTime,oldTime).run();
 await cleanup(env);
 expect((await env.DB.prepare('SELECT run_id FROM offer_snapshots').all<{run_id:string}>()).results.map(r=>r.run_id)).toEqual([live.id]);
 expect((await env.DB.prepare('SELECT count(*) n FROM offers').first<{n:number}>())!.n).toBe(0);
 expect((await env.DB.prepare('SELECT count(*) n FROM scan_runs WHERE id=?').bind(old.id).first<{n:number}>())!.n).toBe(0);
 expect((await env.DB.prepare('SELECT count(*) n FROM price_history').first<{n:number}>())!.n).toBe(0);
 expect((await env.DB.prepare('SELECT count(*) n FROM email_confirmations').first<{n:number}>())!.n).toBe(0);
 expect((await env.DB.prepare("SELECT count(*) n FROM app_state WHERE key LIKE 'rate:%'").first<{n:number}>())!.n).toBe(2);
 expect((await env.DB.prepare('SELECT count(*) n FROM watches').first<{n:number}>())!.n).toBe(1);
 expect(await currentDeals(env)).toHaveLength(1);expect(db.query('PRAGMA foreign_key_check').all()).toHaveLength(0);
});

async function otherShop(env:Env,runId:string,p:Product){const now=new Date().toISOString(),source=sources[1],snapshot=`${runId}:${source.id}`;const rows=normalize({...p,options:[{name:'UK Size',position:1}]},source,now);for(const o of rows)await env.DB.prepare('INSERT INTO offer_snapshots VALUES(?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)').bind(snapshot,runId,o.id,o.source_id,o.product_id,o.title,o.brand,o.category,o.fit,o.size_system,o.size,o.colour,o.price,o.reference_price,o.currency,o.image,o.url,o.available,now).run();await env.DB.prepare("UPDATE sources SET live_snapshot_id=?,last_success=?,status='live' WHERE id=?").bind(snapshot,now,source.id).run();return rows;}

test('one card groups subscribed sizes and excludes other sizes from the email',async()=>{
 const {env}=await database(),p=product(140);p.title='ASICS SonicBlast Mens';p.variants=['8','8.5','9'].map((size,i)=>({...p.variants[0],id:1401+i,option1:`UK ${size}`}));
 const run=await runWithOffers(env,[p]);await watch(env,'small','one@example.test','8');await watch(env,'big','one@example.test','9');const messages:any[]=[];fakeShop([p],messages);
 await planDigests(env,run.id);expect((await dispatchDigests(env,run.id)).sent).toBe(1);const m=messages[0];
 expect(m.html.match(/<h2 /g)).toHaveLength(1);expect(m.html.match(/<img /g)).toHaveLength(1);expect(m.html).toContain('UK 8');expect(m.html).toContain('UK 9');expect(m.html).not.toContain('UK 8.5');expect(m.html).toContain('variant=1401');expect(m.html).toContain('variant=1403');expect(m.subject).toContain('1 find');
 expect(m.html).toContain('Unsubscribe — stop all sale emails');expect(m.headers['List-Unsubscribe']).toMatch(/^<https:\/\/shoe.test\/api\/unsubscribe\?token=.+>$/);expect(m.headers['List-Unsubscribe-Post']).toBe('List-Unsubscribe=One-Click');
});
test('same model across stores selects the cheapest verified size, not first watch or highest discount',async()=>{
 const {env}=await database(),expensive=product(141,'9','120.00');expensive.title='ASICS Sonic Blast Men’s Running Shoes';const cheap=product(142,'9','95.00');cheap.title='ASICS SonicBlast Mens';
 const run=await runWithOffers(env,[expensive]);await otherShop(env,run.id,cheap);await watch(env,'w','one@example.test');const messages:any[]=[];fakeShop([expensive,cheap],messages);
 await planDigests(env,run.id);expect((await dispatchDigests(env,run.id)).sent).toBe(1);expect(messages[0].html.match(/<h2 /g)).toHaveLength(1);expect(messages[0].html).toContain('https://therunhub.ie/products/kayano-142?variant=1421');expect(messages[0].html).not.toContain('variant=1411');expect(messages[0].text).toContain('€95');
});
test('a dead cheapest retailer falls back to a verified alternative of the same model',async()=>{
 const {env}=await database(),good=product(143,'9','110.00'),bad=product(144,'9','90.00');good.title=bad.title='ASICS Sonic Blast Mens';const run=await runWithOffers(env,[good]);await otherShop(env,run.id,bad);await watch(env,'w','one@example.test');const messages:any[]=[];fakeShop([good,bad],messages);const mock=globalThis.fetch;globalThis.fetch=(async(input:unknown,init?:RequestInit)=>init?.method==='HEAD'&&String(input).includes('therunhub')?new Response('',{status:404}):mock(input as any,init)) as typeof fetch;
 await planDigests(env,run.id);expect((await dispatchDigests(env,run.id)).sent).toBe(1);expect(messages[0].html).toContain('variant=1431');expect(messages[0].html).not.toContain('variant=1441');
});
test('recipient receipts survive later scans, price drops, new watches, stores and 90-day log cleanup',async()=>{
 const {env}=await database(),p=product(145);p.title='ASICS SonicBlast Mens';const first=await runWithOffers(env,[p]);await watch(env,'original','one@example.test');const messages:any[]=[];fakeShop([p],messages);await planDigests(env,first.id);expect((await dispatchDigests(env,first.id)).sent).toBe(1);
 const old=new Date(Date.now()-100*86400000).toISOString();await env.DB.prepare('UPDATE digest_jobs SET created_at=?').bind(old).run();await env.DB.prepare('UPDATE notifications SET created_at=?').bind(old).run();await cleanup(env);
 expect((await env.DB.prepare('SELECT job_id,status FROM recommendation_receipts').first<{job_id:string|null;status:string}>())).toEqual({job_id:null,status:'sent'});
 await watch(env,'new-watch','one@example.test');const renamed=product(146,'9','80.00');renamed.title='ASICS Sonic Blast Men’s Running Shoes';const second=await runWithOffers(env,[renamed]);expect((await planDigests(env,second.id)).planned).toBe(0);
 const third=await runWithOffers(env,[]);await otherShop(env,third.id,renamed);expect((await planDigests(env,third.id)).planned).toBe(0);expect(messages).toHaveLength(1);
});
test('already-planned jobs in different slots recheck recipient receipts before sending',async()=>{
 const {env}=await database(),p=product(147),alternative=product(149);alternative.title=p.title;await watch(env,'w','one@example.test');
 const first=await runWithOffers(env,[p]);await planDigests(env,first.id);
 const second=await runWithOffers(env,[]);await otherShop(env,second.id,alternative);
 // Each run still has one current source: both jobs were eligible when planned.
 await env.DB.prepare("UPDATE sources SET live_snapshot_id=? WHERE id='amphibian'").bind(`${first.id}:amphibian`).run();await planDigests(env,second.id);
 const messages:any[]=[];fakeShop([p,alternative],messages);expect((await dispatchDigests(env,first.id)).sent).toBe(1);expect((await dispatchDigests(env,second.id)).sent).toBe(0);expect(messages).toHaveLength(1);
});
test('a timed-out provider attempt keeps its receipt and retries the same frozen message and key',async()=>{
 const {env}=await database(),p=product(148),first=await runWithOffers(env,[p]);await watch(env,'w','one@example.test');const messages:any[]=[];fakeShop([p],messages);const mock=globalThis.fetch,keys:string[]=[];let fail=true;
 globalThis.fetch=(async(input:unknown,init?:RequestInit)=>{if(String(input)==='https://api.resend.com/emails'){keys.push((init?.headers as Record<string,string>)['Idempotency-Key']);if(fail)throw new Error('Simulated lost provider response');}return mock(input as any,init);}) as typeof fetch;
 await planDigests(env,first.id);expect((await dispatchDigests(env,first.id)).sent).toBe(0);expect((await env.DB.prepare('SELECT status FROM recommendation_receipts').first<{status:string}>())!.status).toBe('uncertain');
 const frozen=(await env.DB.prepare('SELECT payload FROM digest_jobs').first<{payload:string}>())!.payload;
 fail=false;await env.DB.prepare('UPDATE digest_jobs SET next_attempt_at=NULL').run();expect((await dispatchDigests(env,first.id)).sent).toBe(1);expect(keys[0]).toBe(keys[1]);expect((await env.DB.prepare('SELECT payload FROM digest_jobs').first<{payload:string}>())!.payload).toBe(frozen);
 const second=await runWithOffers(env,[p]);expect((await planDigests(env,second.id)).planned).toBe(0);expect(messages).toHaveLength(1);
});


test('unsubscribing while stock checks run suppresses the job before the provider call',async()=>{
 const {env}=await database(),p=product(150),run=await runWithOffers(env,[p]);await watch(env,'w','one@example.test');await planDigests(env,run.id);const person=await env.DB.prepare('SELECT unsubscribe_token FROM subscribers').first<{unsubscribe_token:string}>();
 const messages:any[]=[];fakeShop([p],messages);const mock=globalThis.fetch;let stop=true;
 globalThis.fetch=(async(input:unknown,init?:RequestInit)=>{if(init?.method==='HEAD'&&stop){stop=false;await handle(new Request(`https://shoe.test/unsubscribe-all?token=${person!.unsubscribe_token}`,{method:'POST'}),env,'');}return mock(input as any,init);}) as typeof fetch;
 expect((await dispatchDigests(env,run.id)).sent).toBe(0);expect(messages).toHaveLength(0);expect((await env.DB.prepare('SELECT status FROM digest_jobs').first<{status:string}>())!.status).toBe('suppressed');expect((await env.DB.prepare('SELECT count(*) n FROM recommendation_receipts').first<{n:number}>())!.n).toBe(0);
});

test('a fresh published catalogue from an earlier scan can supply the current digest',async()=>{
 const {env}=await database(),p=product(171),earlier=await runWithOffers(env,[p]),current=await runWithOffers(env,[]);
 await env.DB.prepare("UPDATE sources SET live_snapshot_id=? WHERE id='amphibian'").bind(`${earlier.id}:amphibian`).run();
 await watch(env,'w','one@example.test');const messages:any[]=[];fakeShop([p],messages);
 expect((await planDigests(env,current.id)).planned).toBe(1);
 expect((await dispatchDigests(env,current.id)).sent).toBe(1);
 expect(messages).toHaveLength(1);
});

test('a previous catalogue cannot supply stale offers or offers from a failed shop',async()=>{
 const {env}=await database(),p=product(172),earlier=await runWithOffers(env,[p]),current=await runWithOffers(env,[]);
 await env.DB.prepare("UPDATE sources SET live_snapshot_id=?,status='error' WHERE id='amphibian'").bind(`${earlier.id}:amphibian`).run();
 await watch(env,'w','one@example.test');
 expect((await planDigests(env,current.id)).planned).toBe(0);
 await env.DB.prepare("UPDATE scan_runs SET planning_done=0,cursor_email='' WHERE id=?").bind(current.id).run();
 await env.DB.prepare("UPDATE sources SET status='live' WHERE id='amphibian'").run();
 await env.DB.prepare('UPDATE offer_snapshots SET checked_at=?').bind(new Date(Date.now()-31*3600000).toISOString()).run();
 expect((await planDigests(env,current.id)).planned).toBe(0);
});

test('a sold-out refresh publishes an empty sale snapshot and truthful inventory totals',async()=>{
 const {env}=await database();await runWithOffers(env,[product(700)]);
 const sold=product(700);sold.variants[0].available=false;
 const fullPrice=product(701);fullPrice.variants[0].price='100.00';fullPrice.variants[0].compare_at_price='100.00';
 globalThis.fetch=(async(input:unknown)=>String(input).includes('amphibianking')?Response.json({products:[sold,fullPrice]}):new Response('',{status:503})) as typeof fetch;
 await scan(env);
 expect(await currentDeals(env)).toHaveLength(0);
 const summary=JSON.parse((await env.DB.prepare("SELECT value FROM app_state WHERE key='source-summary:amphibian'").first<{value:string}>())!.value);
 expect(summary.products).toBe(2);expect(summary.soldOutProducts).toBe(1);expect(summary.availableProducts).toBe(1);
 const source=await env.DB.prepare("SELECT live_snapshot_id FROM sources WHERE id='amphibian'").first<{live_snapshot_id:string}>();
 expect((await env.DB.prepare('SELECT count(*) n FROM offer_snapshots WHERE snapshot_id=?').bind(source!.live_snapshot_id).first<{n:number}>())!.n).toBe(0);
});

test('retention prunes bounded pages while preserving member data',async()=>{
 const {env}=await database(),old=new Date(Date.now()-100*86400000).toISOString();
 await watch(env,'retention-watch','runner@example.test');
 await env.DB.batch(Array.from({length:251},(_,n)=>env.DB.prepare('INSERT INTO price_history VALUES(?,?,?)').bind(`expired:${n}`,10000,old)));
 for(const remaining of [151,51,0]){
  await cleanup(env);
  expect((await env.DB.prepare('SELECT count(*) n FROM price_history').first<{n:number}>())!.n).toBe(remaining);
 }
 expect((await env.DB.prepare('SELECT count(*) n FROM watches').first<{n:number}>())!.n).toBe(1);
});
test('email candidate and expiry queries have indexes as snapshots grow',async()=>{
 const {db}=await database();
 const lookup=db.query('EXPLAIN QUERY PLAN SELECT * FROM offer_snapshots WHERE id=?').all('variant') as {detail:string}[];
 expect(lookup.some(p=>p.detail.includes('snapshot_offer_lookup'))).toBe(true);
 const expiry=db.query('EXPLAIN QUERY PLAN SELECT rowid FROM offer_snapshots WHERE checked_at<? LIMIT 100').all(new Date().toISOString()) as {detail:string}[];
 expect(expiry.some(p=>p.detail.includes('snapshot_expiry'))).toBe(true);
});
