import type { Offer, Watch } from './types';
type Group=Offer & {sizes:string[];discount:number;sizeUrls:Record<string,string>};
interface Source {id:string;name:string;url:string;adapter:string;status:string;last_success:string|null;product_count:number;error:string|null;region:'IE'|'EU';flag:string;label:string;}
interface Dashboard {offers:Group[];sources:Source[];lastScan:string|null;watches:(Watch & {matchCount:number;email_verified:number})[];emailReady:boolean;pipeline?:{status:string;completed_at:string};nextCheck?:string;}
const $=<T extends HTMLElement=HTMLElement>(s:string)=>document.querySelector<T>(s)!;
const $$=(s:string)=>[...document.querySelectorAll<HTMLElement>(s)];
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const euro=(n:number)=>new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR',maximumFractionDigits:n%100?2:0}).format(n/100);
const categoryNames:Record<string,string>={any:'Any running shoe',daily:'Everyday running',stability:'Support / stability',race:'Speed & racing',trail:'Trail running',unknown:'Running shoe'};
const fitNames:Record<string,string>={men:'Men’s',women:'Women’s',unisex:'Unisex',kids:'Kids’',any:'Any adult fit',unknown:'Fit unconfirmed'};
let data:Dashboard|undefined;
let shown=6;
let lastEmail='';
let toastTimer:ReturnType<typeof setTimeout>;
function ago(time:string|null){if(!time)return 'Not checked yet';const elapsed=Math.max(0,Date.now()-Date.parse(time));if(elapsed<60000)return 'just now';if(elapsed<3600000)return `${Math.floor(elapsed/60000)} minutes ago`;if(elapsed<86400000)return `${Math.floor(elapsed/3600000)} hours ago`;return `${Math.floor(elapsed/86400000)} days ago`;}
function toast(message:string){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,7000);}
async function api(path:string,options:RequestInit={}){const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers}});const result=await response.json();if(!response.ok)throw new Error(result.error??'Couldn’t connect. Please try again.');return result;}
function tab(name:string){for(const n of ['finds','watches'])$(`#panel-${n}`).hidden=n!==name;$$('.nav-item').forEach(b=>{b.classList.toggle('active',b.dataset.tab===name);if(b.dataset.tab===name)b.setAttribute('aria-current','page');else b.removeAttribute('aria-current');});$(`#panel-${name}`).scrollIntoView({behavior:'smooth',block:'start'});}
function value(id:string){return $<HTMLSelectElement>(`#${id}`).value;}
function filtered(){
 const fit=value('filter-fit'),size=value('filter-size'),brand=value('filter-brand'),category=value('filter-category'),region=value('filter-region'),sort=value('sort');
 return (data?.offers??[]).filter(o=>o.discount>=20&&(category==='any'||o.category===category)&&(fit==='any'||o.fit===fit||o.fit==='unisex')&&(size==='any'||o.size_system==='UK'&&o.sizes.includes(size))&&(brand==='any'||o.brand===brand)&&(region==='any'||data!.sources.find(s=>s.id===o.source_id)?.region===region)).sort((a,b)=>sort==='price'?a.price-b.price:sort==='newest'?b.checked_at.localeCompare(a.checked_at):b.discount-a.discount||a.price-b.price);
}
function sizeName(system:string){return system.startsWith('STORE:')?`${data?.sources.find(s=>`STORE:${s.id}`===system)?.name??'Shop'} size`:system;}
function shoeTitle(o:Group){return o.title.replace(/\b(?:men[’']?s|women[’']?s)\b/gi,'').replace(/\s+(?:regular[- ]fit\s+|cushioned\s+)?(?:road\s+)?running shoes?$/i,'').replace(/\s+/g,' ').trim();}
function shopIdentity(s:Source){return `<div class="shop-identity"><span class="shop-flag" aria-hidden="true">${s.flag}</span><span>${esc(s.name)}</span><span class="region-label">${esc(s.label)}</span></div>`;}
function renderProducts(){
 const offers=filtered(),size=value('filter-size');
 $('#result-count').textContent=`${offers.length} ${offers.length===1?'deal':'deals'}`;
 $('#clear-filters').hidden=['filter-fit','filter-size','filter-brand','filter-category','filter-region'].every(id=>value(id)==='any');
 $('#products').innerHTML=offers.length?offers.slice(0,shown).map(o=>{
  const shop=data!.sources.find(s=>s.id===o.source_id)!;
  const sizes=o.sizes.slice(0,8).join(' · ')+(o.sizes.length>8?` · +${o.sizes.length-8} more`:'');
  const sizeLabel=size!=='any'?`UK ${size} available`:o.size_system==='unknown'?`Sizes ${sizes} — check UK equivalent at shop`:`${o.size_system} ${sizes}`;
  const link=size!=='any'?(o.sizeUrls?.[size]??o.url):o.url;
  return `<article class="product-card"><div class="product-photo"><span class="discount-tag">${o.discount}% off</span>${o.image?`<img src="${esc(o.image)}" alt="${esc(o.title)}${o.colour?' in '+esc(o.colour):''}" loading="lazy" width="350" height="230">`:''}</div><div class="product-content">${shopIdentity(shop)}<h3>${esc(shoeTitle(o))}</h3><p class="shoe-fit">${esc(fitNames[o.fit])}</p><p class="product-price">${euro(o.price)} <del aria-label="Shop’s reference price ${euro(o.reference_price!)}">${euro(o.reference_price!)}</del></p><div class="product-sizes">${esc(sizeLabel)}</div><div class="product-buttons"><a class="button button-dark" href="${esc(link)}" target="_blank" rel="noopener noreferrer">Shop at ${esc(shop.name)} <span aria-hidden="true">↗</span></a><button class="watch-shoe" data-watch-offer="${esc(o.id)}" aria-label="Watch ${esc(o.title)} for a deal">Watch this shoe</button></div></div></article>`;
 }).join(''):`<div class="empty-state"><h3>${data?.lastScan?'No deals match yet.':'The first check is on its way.'}</h3><p>${data?.lastScan?'Try another filter, or save a watch and we’ll keep looking.':'Save your size and we’ll look for a deal.'}</p><button class="button button-dark" data-action="new-watch">Watch for a deal <span aria-hidden="true">↗</span></button></div>`;
 $('#show-more').hidden=shown>=offers.length;
}
function renderWatches(){
 $('#watch-count').textContent=String(data!.watches.length);
 $('#email-notice').hidden=data!.emailReady||!data!.watches.length;
 $('#watches').innerHTML=data!.watches.length?data!.watches.map(w=>`<article class="watch-card${w.active?'':' paused'}"><span class="watch-state">${w.active?'Watching':'Paused'}</span><h3>${esc(w.kind==='category'?categoryNames[w.category]:w.query)}</h3><p>${esc(fitNames[w.fit])} · ${esc(sizeName(w.size_system))} ${esc(w.size)}<br>Up to ${euro(w.budget)}</p><span class="watch-match">${w.matchCount?`${w.matchCount} matching ${w.matchCount===1?'offer':'offers'}`:'No matches yet. We’ll keep looking.'}</span>${data!.emailReady&&!w.email_verified?`<div class="verification-action"><span>Email confirmation needed.</span><button class="text-link" data-confirm="${esc(w.id)}">Send confirmation</button></div>`:''}<div class="watch-actions"><button data-pause="${esc(w.id)}">${w.active?'Pause':'Resume'}</button><button data-delete="${esc(w.id)}">Remove</button></div></article>`).join(''):`<div class="empty-state"><h3>What would you like us to find?</h3><p>Choose a shoe, your size and your budget.</p><button class="button button-dark" data-action="new-watch">Add my first watch <span aria-hidden="true">＋</span></button></div>`;
}
function renderSources(){
 $('#sources').innerHTML=data!.sources.map(s=>{
  const stale=s.last_success&&Date.now()-Date.parse(s.last_success)>30*3600000;
  const status=s.adapter==='planned'?'planned':stale?'stale':s.status;
  const labels:Record<string,string>={live:'Checked',planned:'Coming later',error:'Check failed',partial:'Limited coverage',stale:'Check overdue'};
  return `<article class="source-card">${shopIdentity(s)}<div class="source-bottom"><span class="source-status ${status==='live'?'':status==='planned'?'planned':'partial'}">${labels[status]??'Not checked yet'}</span><span>${s.last_success?`${s.product_count} shoes · ${esc(ago(s.last_success))}`:'Not connected'}</span></div>${s.error?`<details><summary>Check details</summary><p>${esc(s.error)}</p></details>`:''}<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Visit ${esc(s.name)} ↗</a></article>`;
 }).join('');
}
async function load(){
 data=await api('/api/dashboard');
 $('#scan-status').textContent=data!.lastScan?`Checked ${ago(data!.lastScan)}`:'First check pending';
 const brands=[...new Set(data!.offers.map(o=>o.brand))].sort(),prev=value('filter-brand');
 $('#filter-brand').innerHTML='<option value="any">Any brand</option>'+brands.map(b=>`<option value="${esc(b)}">${esc(b)}</option>`).join('');if(brands.includes(prev))$<HTMLSelectElement>('#filter-brand').value=prev;
 const watchBrands=[...new Set([...brands,'ASICS','HOKA','BROOKS','SAUCONY','NIKE','ADIDAS','NEW BALANCE','ON','PUMA','MIZUNO'])].sort();$('#watch-brand').innerHTML=watchBrands.map(b=>`<option value="${esc(b)}">${esc(b)}</option>`).join('');
 $('#model-suggestions').innerHTML=[...new Set(data!.offers.map(shoeTitle))].slice(0,150).map(t=>`<option value="${esc(t)}"></option>`).join('');
 $('#pipeline-status').textContent=`Checks at 08:00 and 20:00, Dublin time. ${data!.pipeline?`Latest run: ${data!.pipeline.status}.`:''} Prices and links are checked again before sale emails.`;
 renderProducts();renderWatches();renderSources();
}
function selectKind(kind:string){if(kind!=='model'){$<HTMLInputElement>('[name="size_system"]').value='UK';$('#watch-size-label').textContent='UK size';}for(const name of ['category','brand','model']){$(`#${name}-field`).hidden=name!==kind;$<HTMLInputElement>(`input[name="kind"][value="${name}"]`).checked=name===kind;} $<HTMLInputElement>('[name="model"]').required=kind==='model';}
function step(second:boolean){$('#watch-step-one').hidden=second;$('#watch-step-two').hidden=!second;$('#watch-progress').textContent=second?'Step 2 of 2':'Step 1 of 2';}
function openWatch(offer?:Group){
 if(!data){toast('Deals are still loading. Please try again in a moment.');return;}
 $<HTMLFormElement>('#watch-form').reset();for(const option of [...$<HTMLSelectElement>('#watch-size').options])option.disabled=false;$('#watch-error').textContent='';step(false);selectKind(offer?'model':'category');$<HTMLInputElement>('#watch-email').value=lastEmail;
 if(value('filter-size')!=='any')$<HTMLSelectElement>('#watch-size').value=value('filter-size');
 if(value('filter-fit')!=='any')$<HTMLSelectElement>('[name="fit"]').value=value('filter-fit');
 $('#watch-size-label').textContent='UK size';if(offer){if(offer.size_system==='unknown'){$<HTMLInputElement>('[name="size_system"]').value=`STORE:${offer.source_id}`;$('#watch-size-label').textContent=`Size at ${data.sources.find(s=>s.id===offer.source_id)!.name} (as listed)`;const sel=$<HTMLSelectElement>('#watch-size');for(const option of [...sel.options])option.disabled=!!option.value&&!offer.sizes.includes(option.value);sel.value=offer.sizes[0];}$<HTMLInputElement>('[name="model"]').value=shoeTitle(offer);$<HTMLSelectElement>('[name="fit"]').value=['men','women','kids'].includes(offer.fit)?offer.fit:'any';$<HTMLInputElement>('[name="budget"]').value=String(Math.ceil(offer.price/100));}
 $('#email-explanation').textContent=data.emailReady?'We’ll send a link to confirm your email. No password.':'Email alerts aren’t ready yet. We’ll save your watch here for now.';
 $<HTMLDialogElement>('#watch-dialog').showModal();
}
const sizes=Array.from({length:30},(_,i)=>String(.5+i*.5));$('#watch-size').innerHTML+=sizes.map(s=>`<option value="${s}">${s}</option>`).join('');$('#filter-size').innerHTML+=sizes.map(s=>`<option value="${s}">${s}</option>`).join('');
document.addEventListener('click',async event=>{
 const target=(event.target as HTMLElement).closest<HTMLElement>('button');if(!target)return;
 if(target.dataset.tab)tab(target.dataset.tab);
 if(target.dataset.action==='new-watch')openWatch();
 if(target.dataset.close)$<HTMLDialogElement>(`#${target.dataset.close}`).close();
 if(target.dataset.watchOffer)openWatch(data!.offers.find(o=>o.id===target.dataset.watchOffer));
 if(target.dataset.pause||target.dataset.delete||target.dataset.confirm){
  const id=target.dataset.pause??target.dataset.delete??target.dataset.confirm,w=data!.watches.find(w=>w.id===id)!;
  target.setAttribute('disabled','');
  try{
   if(target.dataset.confirm){const r=await api(`/api/watches/${id}/confirm`,{method:'POST',body:'{}'});toast(r.confirmation==='sent'?'Check your inbox for the confirmation link.':r.confirmation==='pending'?'Your confirmation link is already in your inbox.':'Confirmation could not be sent yet. Please try tomorrow.');}
   else{await api(`/api/watches/${id}`,{method:target.dataset.delete?'DELETE':'PATCH',body:target.dataset.delete?undefined:JSON.stringify({active:!w.active})});await load();toast(target.dataset.delete?'Watch removed.':w.active?'Watch paused.':'Watch resumed.');}
  }catch(e){toast((e as Error).message);}finally{target.removeAttribute('disabled');}
 }
});
$$('input[name="kind"]').forEach(input=>input.addEventListener('change',()=>selectKind((input as HTMLInputElement).value)));
$('#watch-next').addEventListener('click',()=>{
 const inputs=$$('#watch-step-one input, #watch-step-one select') as (HTMLInputElement|HTMLSelectElement)[];
 for(const input of inputs){if(!input.reportValidity())return;}
 const form=new FormData($<HTMLFormElement>('#watch-form')),kind=String(form.get('kind'));
 const name=kind==='brand'?form.get('brand'):kind==='model'?form.get('model'):categoryNames[String(form.get('category'))];
 $('#watch-summary').textContent=`${name} · ${fitNames[String(form.get('fit'))]} · ${sizeName(String(form.get('size_system')))} ${form.get('size')} · up to ${euro(Number(form.get('budget'))*100)}`;
 step(true);$<HTMLInputElement>('#watch-email').focus();
});
$("[name=fit]").addEventListener('change',()=>{const kids=valueFromFit()==='kids';const size=$<HTMLSelectElement>('#watch-size');for(const option of [...size.options])option.disabled=!!option.value&&(Number(option.value)<(kids?.5:2)||Number(option.value)>(kids?13.5:15));if(size.selectedOptions[0]?.disabled)size.value='';});
function valueFromFit(){return $<HTMLSelectElement>('[name=fit]').value;}
$('#watch-back').addEventListener('click',()=>step(false));
$('#watch-form').addEventListener('submit',async event=>{
 event.preventDefault();const form=new FormData($<HTMLFormElement>('#watch-form')),kind=String(form.get('kind')),button=$<HTMLButtonElement>('#watch-submit');button.disabled=true;$('#watch-error').textContent='';
 try{const result=await api('/api/watches',{method:'POST',body:JSON.stringify({kind,category:form.get('category'),query:kind==='brand'?form.get('brand'):kind==='model'?form.get('model'):'',fit:form.get('fit'),size:form.get('size'),size_system:form.get('size_system'),email:form.get('email'),budget:Math.round(Number(form.get('budget'))*100),min_discount:25,consent:form.get('consent')==='on'})});lastEmail=String(form.get('email'));$<HTMLDialogElement>('#watch-dialog').close();await load();tab('watches');toast(result.confirmation==='sent'?'Watch saved. Check your inbox to confirm your email.':'Your watch is saved in this browser.');}catch(e){$('#watch-error').textContent=(e as Error).message;}finally{button.disabled=false;}
});
for(const id of ['filter-fit','filter-size','filter-brand','filter-category','filter-region','sort'])$(`#${id}`).addEventListener('change',()=>{shown=6;renderProducts();});
$('#clear-filters').addEventListener('click',()=>{for(const id of ['filter-fit','filter-size','filter-brand','filter-category','filter-region'])$<HTMLSelectElement>(`#${id}`).value='any';shown=6;renderProducts();});
$('#show-more').addEventListener('click',()=>{shown+=6;renderProducts();});
$('#feedback-open').addEventListener('click',()=>{$('#feedback-error').textContent='';$<HTMLDialogElement>('#feedback-dialog').showModal();});
$('#feedback-form').addEventListener('submit',async event=>{event.preventDefault();const form=$<HTMLFormElement>('#feedback-form'),values=new FormData(form),button=form.querySelector<HTMLButtonElement>('button[type="submit"]')!;button.disabled=true;try{await api('/api/feedback',{method:'POST',body:JSON.stringify({kind:values.get('kind'),message:values.get('message')})});form.reset();$<HTMLDialogElement>('#feedback-dialog').close();toast('Thank you. Your feedback is saved.');}catch(e){$('#feedback-error').textContent=(e as Error).message;}finally{button.disabled=false;}});
$$('dialog').forEach(dialog=>dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect(),m=e as MouseEvent;if(m.clientX<r.left||m.clientX>r.right||m.clientY<r.top||m.clientY>r.bottom)(dialog as HTMLDialogElement).close();}}));
load().catch(()=>{$('#scan-status').textContent='Couldn’t load deals';$('#result-count').textContent='';$('#products').innerHTML='<div class="empty-state"><h3>Please try again.</h3><p>We couldn’t load the deals. Refresh this page in a moment.</p></div>';});
