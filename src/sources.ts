import type { Offer } from './types';
export const sources = [
 {id:'amphibian',name:'Amphibian King',url:'https://www.amphibianking.ie',adapter:'shopify',collections:['mens-running-shoes','womens-running-shoes'],sizeSystem:'UK'},
 {id:'runhub',name:'The Run Hub',url:'https://therunhub.ie',adapter:'shopify',collections:['all-footwear'],sizeSystem:'unknown'},
 {id:'elverys',name:'Elverys',url:'https://www.elverys.ie',adapter:'shopify',collections:['15-off-running-footwear'],sizeSystem:'unknown'},
 {id:'misterrunning',name:'MisterRunning',url:'https://www.misterrunning.com/en/',adapter:'planned',collections:[],sizeSystem:'unknown'},
 {id:'21run',name:'21RUN',url:'https://21run.com/eu/',adapter:'planned',collections:[],sizeSystem:'unknown'},
 {id:'warehouse',name:'Running Warehouse Europe',url:'https://www.runningwarehouse.eu',adapter:'planned',collections:[],sizeSystem:'unknown'},
 {id:'lifestyle',name:'Life Style Sports',url:'https://www.lifestylesports.com',adapter:'planned',collections:[],sizeSystem:'unknown'},
 {id:'sportsdirect',name:'Sports Direct',url:'https://www.sportsdirect.ie',adapter:'planned',collections:[],sizeSystem:'unknown'},
];
interface Product { id:number; title:string; vendor:string; tags:string[]|string; product_type:string; handle:string; options:{name:string;position:number}[]; images:{src:string}[]; variants:{id:number;price:string;compare_at_price:string|null;available:boolean;option1:string|null;option2:string|null;option3:string|null;featured_image?:{src:string}|null}[]; }
export function normalize(p:Product,source:typeof sources[number],now:string):Offer[] {
 const tags=Array.isArray(p.tags)?p.tags.join(' '):p.tags;
 const text=`${p.title} ${tags} ${p.product_type}`.toLowerCase();
 // Merchandising tags can say “kids-personalisation-available:false” on adult shoes.
 // Product identity, rather than campaign tags, determines footwear exclusions.
 if(/\b(kids|junior|boys|girls|spike|spikes|socks|sandals|recovery slide)\b/i.test(`${p.title} ${p.product_type}`))return [];
 if(!/running|road shoe|trail shoe|footwear/.test(text))return [];
 const genderText=`${p.title} ${p.product_type}`.toLowerCase();
 const fit=/unisex/.test(genderText)?'unisex':/women|womens|woman|ladies/.test(genderText)?'women':/\bmen|mens|man\b/.test(genderText)?'men':'unknown';
 // Categories come from retailer taxonomy, never from guessed medical advice.
 const category=/trail/.test(text)?'trail':/stability|category: support/.test(text)?'stability':/category: racing|carbon plate|speed shoes|racing shoes/.test(text)?'race':/neutral|road/.test(text)?'daily':'unknown';
 const sizeOpt=p.options.find(o=>/size/i.test(o.name));
 const colourOpt=p.options.find(o=>/colou?r/i.test(o.name));
 if(!sizeOpt)return [];
 return p.variants.flatMap(v=>{
 const opts=[v.option1,v.option2,v.option3];const raw=(opts[sizeOpt.position-1]??'').trim();
 const explicit=raw.match(/\b(UK|EU|US)\s*(\d+(?:\.\d+)?)/i);
 const number=explicit?.[2]??(/^\d+(?:\.\d+)?$/.test(raw)?raw:'');
 if(!number)return [];
 const price=Math.round(Number(v.price)*100),reference=Math.round(Number(v.compare_at_price)*100);
 if(!Number.isFinite(price)||price<=0)return [];
 return [{id:`${source.id}:${v.id}`,source_id:source.id,product_id:String(p.id),title:p.title,brand:p.vendor.replace(/^hoka one one$/i,'Hoka').toUpperCase(),category,fit,size_system:explicit?.[1].toUpperCase()??source.sizeSystem,size:String(Number(number)),colour:colourOpt?opts[colourOpt.position-1]??'':'',price,reference_price:reference>price?reference:null,currency:'EUR',image:v.featured_image?.src??p.images[0]?.src??'',url:`${source.url}/products/${p.handle}?variant=${v.id}`,available:v.available?1:0,checked_at:now}];
 });
}
export async function collect(source:typeof sources[number],now:string) {
 const result=new Map<string,Offer>();let complete=true;
 for(const collection of source.collections){
  // Bounded crawl: at most 500 products per collection; report truncated coverage.
  for(let page=1;page<=2;page++){
   const response=await fetch(`${source.url}/collections/${collection}/products.json?limit=250&page=${page}`,{headers:{'User-Agent':'BraveRunnersShoeWatch/0.1 (running-club price comparison)'},signal:AbortSignal.timeout(20000)});
   if(!response.ok)throw new Error(`Store returned HTTP ${response.status}`);
   const data=await response.json() as {products:Product[]};if(!Array.isArray(data.products))throw new Error('Product feed unavailable');
   for(const product of data.products)for(const offer of normalize(product,source,now))result.set(offer.id,offer);
   if(data.products.length<250)break;if(page===2)complete=false;
  }
 }
 return {offers:[...result.values()],complete};
}
