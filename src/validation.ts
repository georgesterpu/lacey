import {lifestyleProduct} from './lifestyle';
import {warehouseProduct} from './warehouse';
import type { Env, Offer } from './types';
import { normalize, sources, type Product } from './sources';
export async function validateProduct(env:Env,runId:string,offer:Offer):Promise<Offer[]> {
 const cutoff=new Date(Date.now()-15*60000).toISOString();
 const cached=await env.DB.prepare('SELECT status,payload FROM product_checks WHERE run_id=? AND source_id=? AND product_id=? AND checked_at>=?').bind(runId,offer.source_id,offer.product_id,cutoff).first<{status:string;payload:string|null}>();
 if(cached)return cached.status==='ok'?JSON.parse(cached.payload??'[]'):[];
 const source=sources.find(s=>s.id===offer.source_id);let checked:Offer[]=[],error:string|null=null;
 try {
  if(source?.adapter==='lifestyle'){checked=await lifestyleProduct(offer.url,new Date().toISOString());}
  else if(source?.adapter==='warehouse'){checked=await warehouseProduct(offer.url,new Date().toISOString());}
  else {
  if(!source||source.adapter!=='shopify')throw new Error('Source adapter is not approved');
  const link=new URL(offer.url),base=new URL(source.url);
  if(link.origin!==base.origin||!/^\/products\/[a-z0-9-]+$/.test(link.pathname)||!/^\d+$/.test(link.searchParams.get('variant')??''))throw new Error('Product URL did not pass the allowlist');
  // A successful feed response alone does not establish that the customer link works.
  let page=await fetch(`${link.origin}${link.pathname}`,{method:'HEAD',redirect:'manual',signal:AbortSignal.timeout(12000)});
  if(page.status===405)page=await fetch(`${link.origin}${link.pathname}`,{method:'GET',redirect:'manual',signal:AbortSignal.timeout(12000)});
  if(page.status!==200)throw new Error(`Shop page returned HTTP ${page.status}`);
  const response=await fetch(`${link.origin}${link.pathname}.js`,{redirect:'manual',signal:AbortSignal.timeout(12000)});
  if(response.status!==200)throw new Error(`Product verification returned HTTP ${response.status}`);
  const data=await response.json() as Record<string,any>;
  if(String(data.id)!==offer.product_id||!Array.isArray(data.variants))throw new Error('Product identity changed');
  const p:Product={id:data.id,title:data.title,vendor:data.vendor,tags:data.tags,product_type:data.type??data.product_type,handle:data.handle,options:Array.isArray(data.options)?data.options.map((o:any,i:number)=>typeof o==='string'?{name:o,position:i+1}:o):[],images:(data.images??[]).map((i:any)=>typeof i==='string'?{src:i}:i),variants:data.variants.map((v:any)=>({...v,price:Number.isSafeInteger(v.price)&&v.price>0?(v.price/100).toFixed(2):'',compare_at_price:Number.isSafeInteger(v.compare_at_price)&&v.compare_at_price>0?(v.compare_at_price/100).toFixed(2):null}))};
  checked=normalize(p,source,new Date().toISOString());if(!checked.length)throw new Error('No verified shoe variants');
  }
 }catch(e){error=(e as Error).message;}
 await env.DB.prepare('INSERT INTO product_checks(run_id,source_id,product_id,status,checked_at,details,payload) VALUES(?,?,?,?,?,?,?) ON CONFLICT(run_id,source_id,product_id) DO UPDATE SET status=excluded.status,checked_at=excluded.checked_at,details=excluded.details,payload=excluded.payload').bind(runId,offer.source_id,offer.product_id,error?'blocked':'ok',new Date().toISOString(),error,error?null:JSON.stringify(checked)).run();
 return checked;
}
export function sameVerifiedOffer(collected:Offer,live:Offer) {
 return collected.id===live.id&&collected.product_id===live.product_id&&live.available===1&&collected.price===live.price&&collected.reference_price===live.reference_price&&collected.size_system===live.size_system&&collected.size===live.size&&collected.fit===live.fit&&collected.colour===live.colour&&collected.brand===live.brand&&collected.title===live.title;
}
