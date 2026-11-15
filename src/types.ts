export interface Statement { bind(...values: unknown[]): Statement; all<T=Record<string,unknown>>(): Promise<{results:T[]}>; first<T=Record<string,unknown>>(): Promise<T|null>; run(): Promise<unknown>; }
export interface DB { prepare(sql:string):Statement; batch(statements:Statement[]):Promise<unknown>; }
export interface Env { DB:DB; RESEND_API_KEY?:string; EMAIL_FROM?:string; APP_URL?:string; CRON_SECRET?:string; DAILY_EMAIL_LIMIT?:string; }
export interface Offer { id:string; source_id:string; product_id:string; title:string; brand:string; category:string; fit:string; size_system:string; size:string; colour:string; price:number; reference_price:number|null; currency:string; image:string; url:string; available:number; checked_at:string; }
export interface Watch { id:string; owner_id:string; email:string; kind:string; query:string; category:string; fit:string; size_system:string; size:string; colour:string; budget:number; min_discount:number; active:number; created_at:string; consent_at:string; }
export const categories = ['any','daily','stability','race','trail'] as const;
export const freshCutoff = () => new Date(Date.now()-30*60*60*1000).toISOString();
export const money = (cents:number) => new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR',maximumFractionDigits: cents%100 ? 2:0}).format(cents/100);
export function discount(o:Pick<Offer,'price'|'reference_price'>) { return o.reference_price && o.reference_price>o.price ? Math.floor((1-o.price/o.reference_price)*100):0; }
export function matches(w:Watch,o:Offer) {
  const sizeSystem=w.size_system===o.size_system||(w.kind==='model'&&w.size_system===`STORE:${o.source_id}`&&o.size_system==='unknown');
  if(!w.active || !o.available || o.checked_at<freshCutoff() || !sizeSystem || w.size!==o.size || o.price>w.budget || discount(o)<w.min_discount) return false;
  if(w.fit==='kids' ? o.fit!=='kids' : o.fit==='kids'||o.fit==='unknown'||(w.fit!=='any' && w.fit!==o.fit && o.fit!=='unisex')) return false;
  if(w.kind==='category' && w.category!=='any' && w.category!==o.category) return false;
  if(w.kind==='brand' && w.query.toLowerCase()!==o.brand.toLowerCase()) return false;
  if(w.kind==='model') { const tokens:string[]=w.query.toLowerCase().match(/[a-z0-9]+/g)??[]; const titleTokens:string[]=o.title.toLowerCase().match(/[a-z0-9]+/g)??[]; if(!tokens.length || !tokens.every(t=>titleTokens.includes(t)))return false; }
  return !w.colour || o.colour.toLowerCase().includes(w.colour.toLowerCase());
}
