import type { Offer } from './types';
const words=(s:string):string[]=>(s.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().match(/[a-z0-9]+/g)??[]);
const brands:Record<string,string[]>={ASICS:['asics'],HOKA:['hoka','hoka one one'],BROOKS:['brooks','brooks running'],NIKE:['nike'],ADIDAS:['adidas'],SAUCONY:['saucony'],MIZUNO:['mizuno'],PUMA:['puma'],'UNDER ARMOUR':['under armour','underarmour'],'NEW BALANCE':['new balance','newbalance'],ON:['on','on running'],ALTRA:['altra'],SALOMON:['salomon'],DYNAFIT:['dynafit'],'INOV-8':['inov8','inov 8']};
export interface ShoeIdentity {key:string;confidence:'normalized'|'source';brand:string;model:string;width:string;}
export function shoeIdentity(o:Pick<Offer,'title'|'brand'|'fit'|'source_id'|'product_id'|'colour'>):ShoeIdentity {
 const rawBrand=words(o.brand).join(''),brand=Object.keys(brands).find(k=>brands[k].some(a=>words(a).join('')===rawBrand));
 const fallback=():ShoeIdentity=>({key:`source:${o.source_id}:${o.product_id}`,confidence:'source',brand:o.brand,model:o.title,width:'unspecified'});
 if(!brand||!['men','women','kids','unisex'].includes(o.fit))return fallback();
 let text=o.title.normalize('NFKD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[’']/g,'');
 // Remove only explicit retailer descriptors. Keep every generation number and
 // performance qualifier (max, trail, pro, GTX, etc.). No fuzzy similarity score.
 text=text.replace(/gore[\s-]*tex/g,' gtx ');
 const width=text.match(/\b(?:[246]e|extra[ -]?wide|wide|narrow)\b/)?.[0]?.replace(/\W/g,'')??'standard';
 text=text.replace(/\b(?:[246]e|extra[ -]?wide|wide|narrow)\b/g,' ');
 const kidStage=o.fit==='kids'?/\b(infant|toddler|junior|youth)\b/.exec(text)?.[1]??'kids':'';
 text=text.replace(/\b(mens?|womens?|ladies|male|female|unisex|kids?|boys?|girls?|children|junior|youth|infant|toddler)\b/g,' ');
 text=text.replace(/\b(?:regular[ -]?fit|lightweight|comfortable|cushioned|road running|running|trainers?|shoes?|footwear)\b/g,' ');
 // A colour is removable only if supplied separately by that retailer.
 const colourWords=words(o.colour);if(colourWords.length){const colour=colourWords.join(' ');text=(' '+words(text).join(' ')+' ').replaceAll(' '+colour+' ',' ');}
 let tokens=words(text);
 for(const alias of [...brands[brand]].sort((a,b)=>b.length-a.length)){const prefix=words(alias);if(prefix.every((w,i)=>tokens[i]===w)){tokens=tokens.slice(prefix.length);break;}}
 if(!tokens.length||tokens.every(t=>['sale','sports','black','white','blue','red','green','grey','gray'].includes(t)))return fallback();
 // Spaces/hyphens inside words may differ, but digit groups remain distinct.
 const model=(tokens.join(' ').match(/[a-z]+|[0-9]+/g)??[]).join('|').replace(/\|(?=[a-z])/g,'');
 return {key:`model:${brand}:${o.fit}:${kidStage}:${width}:${model}`,confidence:'normalized',brand,model,width};
}
export function comparableSize(o:Pick<Offer,'size_system'|'source_id'|'size'>){return `${o.size_system==='unknown'?`STORE:${o.source_id}`:o.size_system}:${o.size}`;}
export interface ShoeCard {key:string;offer:Offer;options:Offer[];}
export function shoeCards(offers:Offer[]):ShoeCard[] {
 const cards=new Map<string,ShoeCard>();
 for(const o of offers){const key=shoeIdentity(o).key;let card=cards.get(key);if(!card){card={key,offer:o,options:[]};cards.set(key,card);}
  const size=comparableSize(o),index=card.options.findIndex(v=>comparableSize(v)===size);
  if(index<0)card.options.push(o);else if(o.price<card.options[index].price||(o.price===card.options[index].price&&o.id<card.options[index].id))card.options[index]=o;
 }
 for(const card of cards.values()){card.options.sort((a,b)=>Number(a.size)-Number(b.size)||a.size_system.localeCompare(b.size_system)||a.source_id.localeCompare(b.source_id)||a.id.localeCompare(b.id));card.offer=[...card.options].sort((a,b)=>a.price-b.price||a.id.localeCompare(b.id))[0];}
 return [...cards.values()].sort((a,b)=>a.offer.price-b.offer.price||a.key.localeCompare(b.key));
}
