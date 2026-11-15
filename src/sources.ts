import {collectTwentyOne} from './twentyone';
import {collectLifestyle} from './lifestyle';
import {collectWarehouse} from './warehouse';
import type { Offer } from './types';
export const sources = [
 {id:'amphibian',name:'Amphibian King',url:'https://www.amphibianking.ie',adapter:'shopify',collections:['mens-running-shoes','womens-running-shoes'],sizeSystem:'UK'},
 {id:'runhub',name:'The Run Hub',url:'https://therunhub.ie',adapter:'shopify',collections:['all-footwear'],sizeSystem:'unknown'},
 {id:'elverys',name:'Elverys',url:'https://www.elverys.ie',adapter:'shopify',collections:['15-off-running-footwear','boys-running-footwear','girls-running-footwear'],sizeSystem:'unknown'},
 {id:'misterrunning',name:'MisterRunning',url:'https://www.misterrunning.com/en/',adapter:'planned',collections:[],sizeSystem:'unknown'},
 {id:'21run',name:'21RUN',url:'https://21run.com/eu/',adapter:'twentyone',collections:[],sizeSystem:'unknown'},
 {id:'warehouse',name:'Running Warehouse Europe',url:'https://www.runningwarehouse.eu',adapter:'planned',collections:[],sizeSystem:'unknown'},
 {id:'lifestyle',name:'Life Style Sports',url:'https://www.lifestylesports.com',adapter:'lifestyle',collections:[],sizeSystem:'unknown'},
 {id:'sportsdirect',name:'Sports Direct',url:'https://www.sportsdirect.ie',adapter:'planned',collections:[],sizeSystem:'unknown'},
];
export interface Product { id:number; title:string; vendor:string; tags:string[]|string; product_type:string; handle:string; options:{name:string;position:number}[]; images:{src:string}[]; variants:{id:number;price:string;compare_at_price:string|null;available:boolean;option1:string|null;option2:string|null;option3:string|null;featured_image?:{src:string}|null}[]; }
export function cents(value:unknown):number|null {if(typeof value!=='string'||!/^\d+(?:\.\d{1,2})?$/.test(value))return null;const [whole,fraction='']=value.split('.');const n=Number(whole)*100+Number(fraction.padEnd(2,'0'));return Number.isSafeInteger(n)&&n>0&&n<=150000?n:null;}
export function isProduct(value:unknown):value is Product {
 if(!value||typeof value!=='object')return false;const p=value as Product;
 return Number.isSafeInteger(p.id)&&p.id>0&&typeof p.title==='string'&&p.title.length>0&&typeof p.vendor==='string'&&typeof p.product_type==='string'&&typeof p.handle==='string'&&/^[a-z0-9][a-z0-9-]*$/.test(p.handle)&&Array.isArray(p.options)&&p.options.every(o=>typeof o.name==='string'&&Number.isInteger(o.position)&&o.position>=1&&o.position<=3)&&Array.isArray(p.images)&&Array.isArray(p.variants)&&p.variants.length>0;
}
export function normalize(p:Product,source:typeof sources[number],now:string):Offer[] {
 if(!isProduct(p))return [];
 const tags=Array.isArray(p.tags)?p.tags.filter(t=>typeof t==='string').join(' '):typeof p.tags==='string'?p.tags:'';
 const text=`${p.title} ${tags} ${p.product_type}`.toLowerCase(),identity=`${p.title} ${p.product_type}`.toLowerCase();
 if(/\b(spikes?|socks|sandals|recovery slide)\b/.test(identity)||!/running|road shoe|trail shoe|footwear/.test(text))return [];
 // Negative campaign metadata such as kids-personalisation:false is not identity.
 const kids=/\b(kids?|junior|boys?|girls?|youth|infant|toddler|children)\b/.test(identity)||/e:gender:kids\b/.test(tags);
 const fit=kids?'kids':/unisex/.test(identity)?'unisex':/women|womens|woman|ladies/.test(identity)?'women':/\bmen|mens|man\b/.test(identity)?'men':'unknown';
 const category=/trail/.test(text)?'trail':/stability|category: support/.test(text)?'stability':/category: racing|carbon plate|speed shoes|racing shoes/.test(text)?'race':/neutral|road/.test(text)?'daily':'unknown';
 const sizeOpt=p.options.find(o=>/size/i.test(o.name)),colourOpt=p.options.find(o=>/colou?r/i.test(o.name));if(!sizeOpt)return [];
 return p.variants.flatMap(v=>{
  if(!v||!Number.isSafeInteger(v.id)||v.id<=0||typeof v.available!=='boolean')return [];
  const opts=[v.option1,v.option2,v.option3],raw=String(opts[sizeOpt.position-1]??'').trim();
  const explicit=raw.match(/^(UK|EU|US)\s*(\d+(?:\.5)?)$/i),numeric=explicit?.[2]??(/^\d+(?:\.5)?$/.test(raw)?raw:'');if(!numeric)return [];
  const optionSystem=sizeOpt.name.match(/\b(UK|EU|US)\b/i)?.[1]?.toUpperCase();
  const system=explicit?.[1].toUpperCase()??optionSystem??source.sizeSystem,size=Number(numeric);
  if(size<0.5||size>(system==='EU'?55:20))return [];
  const price=cents(v.price),reference=cents(v.compare_at_price);if(price===null)return [];
  const image=v.featured_image?.src??p.images[0]?.src??'';
  return [{id:`${source.id}:${v.id}`,source_id:source.id,product_id:String(p.id),title:p.title,brand:p.vendor.replace(/^hoka one one$/i,'Hoka').toUpperCase(),category,fit,size_system:system,size:String(size),colour:colourOpt?String(opts[colourOpt.position-1]??''):'',price,reference_price:reference&&reference>price?reference:null,currency:'EUR',image:image.startsWith('//')?`https:${image}`:image,url:`${source.url.replace(/\/$/,'')}/products/${p.handle}?variant=${v.id}`,available:v.available?1:0,checked_at:now}];
 });
}
export async function collect(source:typeof sources[number],now:string) {
 if(source.adapter==='twentyone')return collectTwentyOne(now);
 if(source.adapter==='lifestyle')return collectLifestyle(now);
 if(source.adapter==='warehouse')return collectWarehouse(now);
 const result=new Map<string,Offer>();let complete=true,rejected=0,seen=0,held=0;
 for(const collection of source.collections){for(let page=1;page<=2;page++){
  const response=await fetch(`${source.url}/collections/${collection}/products.json?limit=250&page=${page}`,{headers:{'User-Agent':'Lacey/0.4 (+size-aware running-shoe price checks)'},signal:AbortSignal.timeout(20000)});
  if(!response.ok)throw new Error(`Store returned HTTP ${response.status}`);
  const data=await response.json() as {products:unknown[]};if(!Array.isArray(data.products))throw new Error('Contract changed: products array missing');
  for(const product of data.products){seen++;if(!isProduct(product)){rejected++;continue;}const offers=normalize(product,source,now);if(!offers.length)held++;const invalid=product.variants.filter(v=>!v||typeof v.available!=='boolean'||cents(v.price)===null).length;if(invalid)rejected++;for(const offer of offers)result.set(offer.id,offer);}
  if(data.products.length<250)break;if(page===2)complete=false;
 }}
 if(seen>0&&rejected/seen>.05)throw new Error(`Contract validation failed for ${rejected}/${seen} products; snapshot quarantined`);
 return {offers:[...result.values()],complete,rejected,seen,held};
}
