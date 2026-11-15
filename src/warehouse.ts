import type {Offer} from './types';
const decode=(s:string)=>s.replace(/&(?:amp|apos|quot|lt|gt|#39);/g,x=>({'&amp;':'&','&apos;':"'",'&#39;':"'",'&quot;':'"','&lt;':'<','&gt;':'>'}[x]!));
const attr=(s:string,name:string)=>decode(s.match(new RegExp(`(?:^|\\s)${name}="([^"]*)"`))?.[1]??'');
function money(s:string){if(!/^\d+[,.]\d{2}$/.test(s))return null;const n=Number(s.replace(',','.'))*100;return Number.isFinite(n)&&n>0&&n<=150000?Math.round(n):null;}
export function warehouseOffers(html:string,url:string,now:string):Offer[]{
 if(!/value="IE"[^>]*selected/.test(html)||!/Prices include VAT/.test(html))throw new Error('Ireland VAT selection not confirmed');
 const identity=html.match(/<div[^>]*class="[^"]*gtm_detail[^>]*>/)?.[0]??'',product=attr(identity,'data-gtm_detail_id'),title=attr(identity,'data-gtm_detail_name'),brand=attr(identity,'data-gtm_detail_brand').toUpperCase();
 const reference=money(html.match(/<del>\s*<span[^>]*>([\d,.]+)/)?.[1]??''),imageTag=html.match(/<img[^>]*itemprop="image"[^>]*>/)?.[0]??'',image=attr(imageTag,'src'),colour=attr(imageTag,'alt').split('\\').slice(2).join(' ').trim();
 const fit=/women/i.test(title)?'women':/unisex/i.test(title)?'unisex':/\bmen/i.test(title)?'men':/kids|junior/i.test(title)?'kids':'unknown';
 if(!product||!title||!brand||fit==='unknown'||!reference)throw new Error('Product identity/reference price missing');
 const rows=[...html.matchAll(/<tr\b[^>]*class="subproduct[^>]*>([\s\S]*?)<\/tr>/g)],offers:Offer[]=[];
 for(const row of rows){const block=row[0],variant=attr(block.match(/<tr[^>]*>/)![0],'data-code'),size=block.match(/data-UK="UK (\d+(?:\.\d+)?)"/)?.[1],price=money(block.match(/itemprop="price" content="([\d.]+)"/)?.[1]??'');
  if(!/itemprop="priceCurrency" content="EUR"/.test(block)||!variant||!size||price===null||!Number.isFinite(Number(size)))continue;
  const available=/itemprop="availability" content="InStock"/.test(block)&&/class="available">[1-9]\d*</.test(block);
  offers.push({id:`warehouse:${variant}`,source_id:'warehouse',product_id:product,title,brand,category:/trail/i.test(title)?'trail':'unknown',fit,size_system:'UK',size:String(Number(size)),colour,price,reference_price:reference,currency:'EUR',image,url:new URL(url).toString(),available:available?1:0,checked_at:now});
 }
 if(!offers.length)throw new Error('No supported size/stock rows');return offers;
}
export async function warehouseProduct(url:string,now:string){const link=new URL(url);if(link.origin!=='https://www.runningwarehouse.eu'||!/^\/[A-Za-z0-9_/-]+\/descpage-[A-Za-z0-9-]+\.html$/.test(link.pathname))throw new Error('Unapproved Warehouse link');link.search='?vat=IE';const response=await fetch(link,{redirect:'error',signal:AbortSignal.timeout(15000)});if(!response.ok)throw new Error(`Warehouse product HTTP ${response.status}`);return warehouseOffers(await response.text(),link.href,now);}
export async function collectWarehouse(now:string){const urls=new Set<string>();for(const code of ['RWMRSSALE','RWWRSSALE']){const r=await fetch(`https://www.runningwarehouse.eu/catpage-${code}-EN.html`,{signal:AbortSignal.timeout(15000)});if(!r.ok)throw new Error(`Warehouse catalogue HTTP ${r.status}`);const html=await r.text();const links=[...html.matchAll(/href="([^"?#]*\/descpage-[A-Za-z0-9-]+\.html)"/g)].map(m=>new URL(decode(m[1]),'https://www.runningwarehouse.eu').href);for(const u of [...new Set(links)].slice(0,24))urls.add(u);}
 const offers:Offer[]=[];let rejected=0;const list=[...urls];for(let i=0;i<list.length;i+=3){const results=await Promise.allSettled(list.slice(i,i+3).map(u=>warehouseProduct(u,now)));for(const r of results)if(r.status==='fulfilled')offers.push(...r.value);else rejected++;}
 if(!offers.length||rejected>list.length*.2)throw new Error(`Warehouse product checks failed (${rejected}/${list.length})`);return {offers,complete:false,rejected,seen:list.length,held:0};}
