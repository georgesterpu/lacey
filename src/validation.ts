import {publicProductStatement,publicFailureStatement} from './public-catalogue';
import {twentyOneProduct} from './twentyone';
import {lifestyleProduct} from './lifestyle';
import {warehouseProduct} from './warehouse';
import {misterProduct} from './misterrunning';
import {sportsProduct} from './sportsdirect';
import type { Env, Offer } from './types';
import { normalize, sources, validProductHandle,type Product } from './sources';
export class ProductCheckRequired extends Error {}
export async function validateProduct(env:Env,runId:string,offer:Offer):Promise<Offer[]> {
 const cutoff=new Date(Date.now()-15*60000).toISOString();
 const cached=await env.DB.prepare('SELECT status,payload FROM product_checks WHERE run_id=? AND source_id=? AND product_id=? AND checked_at>=?').bind(runId,offer.source_id,offer.product_id,cutoff).first<{status:string;payload:string|null}>();
 if(cached)return cached.status==='ok'?JSON.parse(cached.payload??'[]'):[];
 if(env.REQUIRE_PREFLIGHT)throw new ProductCheckRequired('A fresh worker stock check is required');
 const source=sources.find(s=>s.id===offer.source_id);let checked:Offer[]=[],error:string|null=null;
 try {
  if(source?.adapter==='twentyone'){const state=await env.DB.prepare('SELECT status,error FROM sources WHERE id=?').bind(source.id).first<{status:string;error:string|null}>();if(state?.status==='error'&&state.error?.includes('21RUN paused'))throw new Error(state.error);checked=await twentyOneProduct(offer.url,new Date().toISOString());}
  else if(source?.adapter==='lifestyle'){checked=await lifestyleProduct(offer.url,new Date().toISOString());}
  else if(source?.id==='warehouse'){checked=await warehouseProduct(offer.url,new Date().toISOString());}
  else if(source?.id==='misterrunning'){checked=await misterProduct(offer.url,new Date().toISOString());}
  else if(source?.id==='sportsdirect'){checked=await sportsProduct(offer.url,new Date().toISOString());}
  else {
  if(!source||source.adapter!=='shopify')throw new Error('Source adapter is not approved');
  const link=new URL(offer.url),base=new URL(source.url);
  const handle=link.pathname.match(/^\/products\/([^/]+)$/)?.[1];
  if(link.origin!==base.origin||!handle||!validProductHandle(decodeURIComponent(handle))||!/^\d+$/.test(link.searchParams.get('variant')??''))throw new Error('Product URL did not pass the allowlist');
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
 }catch(e){error=(e as Error).message;if(source?.id==='21run'&&error.includes('21RUN paused'))await env.DB.prepare("UPDATE sources SET status='error',error=?,live_snapshot_id=NULL,last_attempt=? WHERE id='21run'").bind(error,new Date().toISOString()).run();}
 await env.DB.batch([...(source?.id==='21run'&&error?.includes('21RUN paused')?[publicFailureStatement(env,source.id,error,new Date().toISOString())]:[]),publicProductStatement(env,offer.source_id,offer.product_id,error?[]:checked),env.DB.prepare('INSERT INTO product_checks(run_id,source_id,product_id,status,checked_at,details,payload) VALUES(?,?,?,?,?,?,?) ON CONFLICT(run_id,source_id,product_id) DO UPDATE SET status=excluded.status,checked_at=excluded.checked_at,details=excluded.details,payload=excluded.payload').bind(runId,offer.source_id,offer.product_id,error?'blocked':'ok',new Date().toISOString(),error,error?null:JSON.stringify(checked))]);
 return checked;
}
export function sameVerifiedOffer(collected:Offer,live:Offer) {
 return collected.id===live.id&&collected.product_id===live.product_id&&live.available===1&&collected.price===live.price&&collected.reference_price===live.reference_price&&collected.size_system===live.size_system&&collected.size===live.size&&collected.fit===live.fit&&collected.colour===live.colour&&collected.brand===live.brand&&collected.title===live.title;
}
