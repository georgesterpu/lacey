import type {Offer} from './types';
const origin='https://21run.com',ua='Lacey/0.4 (+https://lacey.january.ie; twice-daily shoe-price checks)';
export const twentyOneLimits={productsPerDepartment:2,sizesPerProduct:4,requestIntervalMs:1000};
const decode=(s:string)=>s.replace(/&(?:amp|quot|apos|lt|gt|#\d+|#x[\da-f]+);/gi,x=>x.startsWith('&#')?String.fromCodePoint(parseInt(x.slice(x[2]==='x'?3:2,-1),x[2]==='x'?16:10)):({'&amp;':'&','&quot;':'"','&apos;':"'",'&lt;':'<','&gt;':'>'}[x]??x));
const attribute=(tag:string,key:string)=>decode(tag.match(new RegExp(`(?:^|\\s)${key}="([^"]*)"`))?.[1]??'');
export function twentyOneLink(url:string){const u=new URL(url);if(u.origin!==origin||!/^\/eu\/[a-z0-9][a-z0-9-]+$/.test(u.pathname)||u.search||u.hash)throw new Error('21RUN product URL is not approved');return u.href;}
export function robotsAllows(text:string,path:string){
 const groups:{agents:string[];rules:{allow:boolean;path:string}[]}[]=[];let g:{agents:string[];rules:{allow:boolean;path:string}[]}={agents:[],rules:[]};
 for(const line of text.replaceAll('\\r\\n','\n').split(/\r?\n/)){const m=line.split('#')[0].trim().match(/^([\w-]+):\s*(.*)$/);if(!m)continue;const key=m[1].toLowerCase(),value=m[2].trim();if(key==='user-agent'){if(g.rules.length){groups.push(g);g={agents:[],rules:[]};}g.agents.push(value.toLowerCase());}else if((key==='allow'||key==='disallow')&&value)g.rules.push({allow:key==='allow',path:value});}groups.push(g);
 const named=groups.filter(x=>x.agents.some(a=>a!=='*'&&'lacey'.includes(a))),relevant=named.length?named:groups.filter(x=>x.agents.includes('*'));
 const rules=relevant.flatMap(x=>x.rules).filter(r=>new RegExp('^'+r.path.split('*').map(p=>p.replace(/[.+?^{}()|[\]\\]/g,'\\$&')).join('.*').replace(/\\\$$/,'$')).test(path)).sort((a,b)=>b.path.length-a.path.length||Number(b.allow)-Number(a.allow));
 return rules[0]?.allow??true;
}
let queue:Promise<unknown>=Promise.resolve(),nextRequest=0,blockedUntil=0;
async function request(url:string,policy?:string){
 const work=queue.then(async()=>{
  if(Date.now()<blockedUntil)throw new Error('21RUN paused after blocked/rate-limited response');
  const link=new URL(url);if(link.origin!==origin||link.search||link.hash)throw new Error('21RUN request is not approved');
  if(policy&&!robotsAllows(policy,link.pathname))throw new Error('21RUN robots.txt disallows this request');
  await Bun.sleep(Math.max(0,nextRequest-Date.now()));nextRequest=Date.now()+twentyOneLimits.requestIntervalMs;
  const response=await fetch(link,{headers:{'User-Agent':ua,Accept:'text/html,application/json'},redirect:'error',signal:AbortSignal.timeout(15000)});
  if([401,403,406,429].includes(response.status)){blockedUntil=Date.now()+12*3600000;await response.body?.cancel();throw new Error(`21RUN paused: HTTP ${response.status}; no automatic retry for 12 hours`);}
  if(!response.ok){await response.body?.cancel();throw new Error(`21RUN HTTP ${response.status}`);}return response.text();
 });queue=work.catch(()=>{});return work;
}
interface Size {attribute_code:string;label:{content:string};}
interface Variant {sku:string;parent_sku:string;brand:string;name:string;color:string;gender:string;is_available:number;stock:{qty:number;is_in_stock:number;backorder_mode:number};sizes:Size[];}
interface SizeResponse {products:Variant[];size_table?:string;}
interface Selected {sku:string;preselected_sku:string;title:string;product_url:string;price:{currency:string;price:number;special_price?:number};sizes:Size[];frontend_attributes:{label:string;value:string}[];gallery:{img:string;is_main:boolean}[];}
function cents(n:unknown){if(typeof n!=='number'||!Number.isFinite(n)||n<=0||n>1500||Math.abs(n*100-Math.round(n*100))>.00001)throw new Error('21RUN invalid price');return Math.round(n*100);}
export function twentyOneOffers(url:string,sku:string,data:unknown,selected:unknown[],now:string):Offer[]{
 const canonical=twentyOneLink(url),d=data as SizeResponse;if(!Array.isArray(d?.products)||!d.products.length)throw new Error('21RUN size contract changed');
 const uk=new Map<string,string>();for(const m of (d.size_table??'').matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)){const cells=[...m[1].matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map(x=>decode(x[1].replace(/<[^>]+>/g,'')).trim().replace(',','.'));if(cells.length===4&&/^\d+(?:\.\d+| [12]\/3)?$/.test(cells[0])&&/^\d+(?:\.5)?$/.test(cells[2])&&Number(cells[2])>0&&Number(cells[2])<=20)uk.set(cells[0],String(Number(cells[2])));}
 if(uk.size&&!/<th[^>]*>\s*EU\s*<\/th>[\s\S]*?<th[^>]*>\s*US\s*<\/th>[\s\S]*?<th[^>]*>\s*UK\s*<\/th>/i.test(d.size_table??''))throw new Error('21RUN size table headers changed');
 const offers:Offer[]=[];const seen=new Set<string>();
 for(const raw of selected){const p=raw as Selected,v=d.products.find(x=>x.sku===p?.preselected_sku);if(!v||v.parent_sku!==sku||p.sku!==sku||twentyOneLink(p.product_url)!==canonical||!Array.isArray(p.sizes)||!Array.isArray(v.sizes)||!Array.isArray(p.frontend_attributes)||!p.title||!v.brand||!v.color)throw new Error('21RUN product identity mismatch');
  if(seen.has(v.sku))throw new Error('21RUN duplicate variant');seen.add(v.sku);
  const eu=v.sizes.find(s=>s.attribute_code==='size_eu')?.label?.content;if(!eu||!/^\d+(?:[.,]\d+| [12]\/3)?$/.test(eu))throw new Error('21RUN size missing');const euSize=eu.replace(',','.'),chosen=p.sizes.find(s=>s.attribute_code==='size_eu')?.label?.content;
  if(!uk.has(euSize)&&!/^\d+(?:\.5)?$/.test(euSize))continue;
  if(!chosen||chosen.replace(/\s*EU$/,'').replace(',','.')!==euSize)throw new Error('21RUN selected size mismatch');
  if(p.price?.currency!=='EUR')throw new Error('21RUN currency mismatch');const regular=cents(p.price.price),price=p.price.special_price==null?regular:cents(p.price.special_price);if(price>regular)throw new Error('21RUN contradictory price');
  const gender=String(v.gender).toLowerCase(),fit=/kids|junior|child|boys|girls|youth/.test(gender)?'kids':gender==='women'?'women':gender==='men'?'men':gender==='unisex'?'unisex':'unknown';if(fit==='unknown')throw new Error('21RUN department unknown');
  const attrs=new Map(p.frontend_attributes.map(a=>[a.label,a.value]));if(attrs.get('Article number')!==sku||attrs.get('Brand')?.toUpperCase()!==v.brand.toUpperCase()||attrs.get('Colour')!==v.color||attrs.get('Gender')!==v.gender||p.title!==v.name)throw new Error('21RUN metadata mismatch');
  const group=attrs.get('Article group')??'';if(!/running shoes/i.test(group)||/spikes/i.test(group))continue;
  const category=/trail/i.test(group)?'trail':/stability/i.test(attrs.get('Shoe type')??'')?'stability':/race|competition/i.test(group)?'race':/neutral/i.test(attrs.get('Shoe type')??'')?'daily':'unknown';
  const available=v.is_available===1&&v.stock?.is_in_stock===1&&typeof v.stock.qty==='number'&&v.stock.qty>0&&v.stock.backorder_mode===0;
  offers.push({id:`21run:${v.sku}`,source_id:'21run',product_id:sku,title:p.title,brand:v.brand.toUpperCase(),category,fit,size_system:uk.has(euSize)?'UK':'EU',size:uk.get(euSize)??euSize,colour:v.color,price,reference_price:regular>price?regular:null,currency:'EUR',image:p.gallery?.find(i=>i.is_main)?.img??'',url:canonical,available:available?1:0,checked_at:now});
 }
 if(!offers.length)throw new Error('21RUN has no supported verified running-shoe variants');return offers;
}
async function product(url:string,now:string,policy:string){
 const canonical=twentyOneLink(url),html=await request(canonical,policy),metas=[...html.matchAll(/<meta\b[^>]*>/g)].map(m=>m[0]);
 const sku=metas.find(t=>attribute(t,'itemprop')==='sku');const id=sku?attribute(sku,'content'):'';
 const canonicalTag=html.match(/<link\b[^>]*rel="canonical"[^>]*>/)?.[0];if(!id||!/^[A-Za-z0-9._-]+$/.test(id)||!canonicalTag||attribute(canonicalTag,'href')!==canonical)throw new Error('21RUN product page identity missing');
 const base=`${origin}/eu/rest/eu/V1/`,data=JSON.parse(await request(`${base}sizeselector/sizeselector/${id}`,policy)) as SizeResponse;
 if(!Array.isArray(data.products))throw new Error('21RUN size contract changed');
 // Check prices separately for each available variant; never copy the headline minimum.
 const variants=data.products.filter(v=>v.parent_sku===id&&v.is_available===1&&v.stock?.is_in_stock===1&&v.stock.qty>0&&v.stock.backorder_mode===0).slice(0,twentyOneLimits.sizesPerProduct),selected:unknown[]=[];
 if(!variants.length)return [];
 for(const v of variants){if(!/^[A-Za-z0-9._-]+$/.test(v.sku))throw new Error('21RUN invalid variant SKU');selected.push(JSON.parse(await request(`${base}product-offer/product-alternative/${id}/${v.sku}`,policy)));}
 return twentyOneOffers(canonical,id,data,selected,now);
}
export async function twentyOneProduct(url:string,now:string){const policy=await request(`${origin}/robots.txt`);return product(url,now,policy);}
export function twentyOneCatalogue(html:string){
 const links:string[]=[];for(const m of html.matchAll(/\sdata-product="([^"]+)"/g)){let p;try{p=JSON.parse(decode(m[1]));}catch{throw new Error('21RUN catalogue product contract changed');}if(typeof p.url!=='string'||typeof p.price!=='number'||typeof p.special_price!=='number'||p.special_price<=0||p.special_price>p.price*.8)continue;links.push(twentyOneLink(p.url));}return [...new Set(links)];
}
export async function collectTwentyOne(now:string){
 const policy=await request(`${origin}/robots.txt`),urls=new Set<string>();let saleHtml="";
 // Bounded initial coverage with independent adult and kids discovery.
 for(const [path,department] of [['sale/running-shoes','men'],['sale/running-shoes','women'],['running-shoes/kids','kids']] as const){
  const key=`${origin}/eu/${path}`;const html=path==='sale/running-shoes'&&saleHtml?saleHtml:await request(key,policy);if(path==='sale/running-shoes')saleHtml=html;
  const links=twentyOneCatalogue(html).filter(u=>department==='kids'||new RegExp(`-${department}-`).test(u));for(const url of links.slice(0,twentyOneLimits.productsPerDepartment))urls.add(url);
 }
 saleHtml='';if(!urls.size)throw new Error('21RUN catalogue contract changed: no product links');
 const offers:Offer[]=[];let held=0;for(const url of urls){const result=await product(url,now,policy);if(!result.length)held++;offers.push(...result);}
 return {offers,complete:false,rejected:0,seen:urls.size,held};
}
