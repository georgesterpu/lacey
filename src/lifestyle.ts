import type {Offer} from './types';
import {retailerPage, RetailerRequestError} from './retailer-http';
const decode=(s:string)=>s.replace(/&quot;/g,'"').replace(/&#39;|&apos;/g,"'").replace(/&amp;/g,'&');
const amount=(s:string)=>/^\d+\.\d{2}$/.test(s)&&Number(s)>0&&Number(s)<=1500?Math.round(Number(s)*100):null;
export function lifestyleLink(url:string){
 const u=new URL(url);
 if(u.origin!=='https://www.lifestylesports.com'||u.username||u.password||u.hash||!/^\/ie\/(?:[a-z0-9-]+\.html|variation|c\/(?:mens|womens|kids)\/running-shoes\/)$/.test(u.pathname))throw new Error('Unapproved Lifestyle URL');
 if(u.pathname==='/ie/variation'){
  const pid=u.searchParams.get('pid'),size=pid&&u.searchParams.get(`dwvar_${pid}_LSSSize`);
  if(!pid||!/^\d{1,20}$/.test(pid)||!size||!/^\d+(?:\.5)?$/.test(size)||Number(size)<.5||Number(size)>20||u.searchParams.size!==2)throw new Error('Unapproved Lifestyle size URL');
 }else if(u.search)throw new Error('Unapproved Lifestyle query');
 return u.href;
}
const page=(url:string)=>retailerPage(lifestyleLink(url));
export function lifestyleListing(html:string){
 const tiles=html.split('<div class="product-tile').slice(1);
 if(!tiles.length)throw new Error('Lifestyle catalogue contract missing');
 const links=new Set<string>();
 for(const block of tiles){
  if(!block.includes('%22price_type%22%3A%22sale%22'))continue;
  const match=block.match(/class="name-link" href="([^"]+)"/);
  if(!match)throw new Error('Lifestyle sale product link missing');
  const u=new URL(decode(match[1]));u.search='';links.add(lifestyleLink(u.href));
 }
 return [...links];
}
export function lifestyleSizes(html:string){
 const swatches=html.match(/<ul class="swatches lsssize">([\s\S]*?)<\/ul>/)?.[1];
 if(swatches===undefined)throw new Error('Lifestyle size choices missing');
 return [...new Set([...swatches.matchAll(/class="swatchanchor"\s+href="([^"]+)"/g)].map(m=>lifestyleLink(decode(m[1]))))];
}
export function lifestyleVariant(html:string,url:string,now:string):Offer|null{
 lifestyleLink(url);
 if(!/itemprop="priceCurrency" content="EUR"/.test(html))throw new Error('Lifestyle currency not confirmed');
 const data=html.match(/class="product-cta row" data-gtm-product="([^"]+)"/)?.[1];if(!data)throw new Error('Lifestyle identity missing');const info=JSON.parse(decodeURIComponent(decode(data)));
 if(typeof info.item_brand!=='string'||!info.item_brand||typeof info.item_name!=='string'||!info.item_name)throw new Error('Lifestyle model missing');
 const price=amount(html.match(/class="price-sales[^>]*content="([\d.]+)"/)?.[1]??''),reference=amount(html.match(/class="price-standard">\s*&#8364;([\d.]+)/)?.[1]??'');if(!reference||!price)return null;
 const input=html.match(/<input[^>]*data-available="\d+"[^>]*>/)?.[0]??'',variant=input.match(/data-product-id="(\d+)"/)?.[1],master=input.match(/data-master-product-id="(\d+)"/)?.[1],stock=Number(input.match(/data-available="(\d+)"/)?.[1]??0);
 if(variant&&String(info.item_id)!==variant)throw new Error('Lifestyle selected variant identity mismatch');
 const u=new URL(url),size=u.searchParams.get(`dwvar_${master}_LSSSize`);if(!master||!variant||!size||!/^\d+(?:\.5)?$/.test(size))return null;
 const swatches=html.match(/<ul class="swatches lsssize">([\s\S]*?)<\/ul>/)?.[1]??'',selected=swatches.match(/<li class="[^"]*\bselected\b[^"]*">([\s\S]*?)<\/li>/)?.[1]??'',selectedUrl=selected.match(/href="([^"]+)"/)?.[1];if(!selectedUrl||new URL(decode(selectedUrl)).searchParams.get(`dwvar_${master}_LSSSize`)!==size)throw new Error('Lifestyle selected size mismatch');
 const title=String(info.item_brand)+' '+String(info.item_name),fit=/women/i.test(title)?'women':/\bmen/i.test(title)?'men':/kids|junior|boys|girls/i.test(title)?'kids':'unknown';if(fit==='unknown')return null;
 return {id:`lifestyle:${variant}`,source_id:'lifestyle',product_id:master,title,brand:String(info.item_brand).toUpperCase(),category:/trail/i.test(title)?'trail':'unknown',fit,size_system:'unknown',size:String(Number(size)),colour:decode(html.match(/itemprop="color" content="([^"]*)"/)?.[1]??''),price,reference_price:reference,currency:'EUR',image:decode(html.match(/property="og:image" content="([^"]+)"/)?.[1]??''),url:u.href,available:stock>0?1:0,checked_at:now};
}
export async function lifestyleProduct(url:string,now:string){const html=await page(url);const links=lifestyleSizes(html);const offers:Offer[]=[];
 for(let i=0;i<links.length;i+=3){for(const result of await Promise.all(links.slice(i,i+3).map(async link=>lifestyleVariant(await page(link),link,now))))if(result)offers.push(result);}
 return offers;}
export async function collectLifestyle(now:string){
 const deadline=Date.now()+7*60000,links=new Set<string>();
 // These public entry pages are allowed. The retailer disallows its ?start=
 // pagination routes; do not reorder queries or use hidden endpoints to evade it.
 for(const department of ['mens','womens','kids'])
  for(const link of lifestyleListing(await page(`https://www.lifestylesports.com/ie/c/${department}/running-shoes/`)))links.add(link);
 const offers:Offer[]=[];let rejected=0;
 for(const link of links){
  if(Date.now()>deadline)throw new Error('Lifestyle collection budget exceeded; previous snapshot retained');
  try{offers.push(...await lifestyleProduct(link,now));}
  catch(error){if(error instanceof RetailerRequestError||['AbortError','TimeoutError'].includes((error as Error).name))throw error;rejected++;}
 }
 if(!offers.length||rejected>links.size*.05)throw new Error(`Lifestyle product checks failed (${rejected}/${links.size})`);
 return {offers,complete:false,rejected,seen:links.size,held:0};
}
