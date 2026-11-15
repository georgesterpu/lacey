import type { Offer, Watch } from './types';
type Group=Offer & {sizes:string[];discount:number};
interface Source {id:string;name:string;url:string;adapter:string;status:string;last_success:string|null;last_attempt:string|null;product_count:number;error:string|null;}
interface Dashboard {offers:Group[];sources:Source[];lastScan:string|null;watches:(Watch & {matchCount:number})[];user:{email:string;signedIn:boolean}|null;emailReady:boolean;}
const $=<T extends HTMLElement=HTMLElement>(s:string)=>document.querySelector<T>(s)!;
const $$=(s:string)=>[...document.querySelectorAll<HTMLElement>(s)];
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!));
const euro=(n:number)=>new Intl.NumberFormat('en-IE',{style:'currency',currency:'EUR',maximumFractionDigits:n%100?2:0}).format(n/100);
const categoryNames:Record<string,string>={any:'Any running shoe',daily:'Everyday miles',stability:'Extra support',race:'Pick up the pace',trail:'Off the road',unknown:'Running shoe'};
const fitNames:Record<string,string>={men:'Men’s',women:'Women’s',unisex:'Unisex',any:'Any fit',unknown:'Fit unconfirmed'};
let data:Dashboard;let category='any';let shown=9;let toastTimer:ReturnType<typeof setTimeout>;
function ago(time:string|null){if(!time)return 'Not checked yet';const elapsed=Math.max(0,Date.now()-Date.parse(time));if(elapsed<60000)return 'Just checked';if(elapsed<3600000)return `${Math.floor(elapsed/60000)}m ago`;if(elapsed<86400000)return `${Math.floor(elapsed/3600000)}h ago`;return `${Math.floor(elapsed/86400000)}d ago`;}
function toast(message:string){clearTimeout(toastTimer);$('#toast').textContent=message;$('#toast').hidden=false;toastTimer=setTimeout(()=>$('#toast').hidden=true,5000);}
async function api(path:string,options:RequestInit={}){const response=await fetch(path,{...options,headers:{'Content-Type':'application/json',...options.headers}});const result=await response.json();if(!response.ok)throw new Error(result.error??'Couldn’t connect. Please try again.');return result;}
function tab(name:string){for(const n of ['finds','watches','sources'])$(`#panel-${n}`).hidden=n!==name;$$('.nav-item').forEach(b=>b.classList.toggle('active',b.dataset.tab===name));if(name!=='finds')$(`#panel-${name}`).scrollIntoView({behavior:'smooth',block:'start'});}
function filtered(){const fit=$<HTMLSelectElement>('#filter-fit').value,size=$<HTMLSelectElement>('#filter-size').value,brand=$<HTMLSelectElement>('#filter-brand').value,sort=$<HTMLSelectElement>('#sort').value;return data.offers.filter(o=>o.discount>=20&&(category==='any'||o.category===category)&&(fit==='any'||o.fit===fit||o.fit==='unisex')&&(size==='any'||o.size_system==='UK'&&o.sizes.includes(size))&&(brand==='any'||o.brand===brand)).sort((a,b)=>sort==='price'?a.price-b.price:sort==='newest'?b.checked_at.localeCompare(a.checked_at):b.discount-a.discount||a.price-b.price);}
function renderProducts(){
 const offers=filtered();$('#result-count').textContent=`${offers.length} ${offers.length===1?'find':'finds'} · in stock at last check`;
 $('#products').innerHTML=offers.length?offers.slice(0,shown).map(o=>{
  const source=data.sources.find(s=>s.id===o.source_id)!;const title=o.title.replace(/\b(men'?s|women'?s)\s*(road )?(running )?(shoes?)?$/i,'').trim();
  const sizes=o.sizes.length>6?`${o.sizes.slice(0,6).join(' / ')} +${o.sizes.length-6}`:o.sizes.join(' / ');
  return `<article class="product-card"><div class="product-photo"><span class="discount-tag">−${o.discount}%</span><button class="save-shoe" data-watch-offer="${esc(o.id)}" aria-label="Watch ${esc(o.title)}">＋</button>${o.image?`<img src="${esc(o.image)}" alt="${esc(o.title)}${o.colour?' in '+esc(o.colour):''}" loading="lazy" width="350" height="225">`:''}</div><div class="product-meta"><span>${esc(o.brand)}</span><span>${esc(fitNames[o.fit])} · ${esc(categoryNames[o.category])}</span></div><h3>${esc(title)}</h3><div class="product-price">${euro(o.price)} <del>${euro(o.reference_price!)}</del><span class="delivery-note">+ delivery</span></div><div class="product-sizes">${o.size_system==='unknown'?'Size system unconfirmed':esc(o.size_system)} · ${esc(sizes)}</div><div class="product-bottom"><span>${esc(source.name)} · ${ago(o.checked_at)}</span><a href="${esc(o.url)}" target="_blank" rel="noopener noreferrer">See the pair <span>↗</span></a></div></article>`;
 }).join(''):`<div class="empty-state"><h3>${data.lastScan?'Nothing quite right. Yet.':'The first lap is still ahead.'}</h3>${data.lastScan?'No current finds match those filters. Try another size, or save a watch and let the good ones come to you.':'The watch is ready. The first retailer scan will bring real shoes and prices onto these shelves.'}<br><button class="button button-dark" data-action="new-watch">Start a watch <span>↗</span></button></div>`;
 $('#show-more').hidden=shown>=offers.length;
}
function renderWatches(){
 $('#watch-count').textContent=String(data.watches.length);$('#email-notice').hidden=data.emailReady;
 $('#watches').innerHTML=data.watches.length?data.watches.map(w=>`<article class="watch-card${w.active?'':' paused'}"><p class="eyebrow">${w.active?'ON YOUR RADAR':'TAKING A BREATHER'} / ${w.kind==='category'?'A TYPE OF RUN':w.kind==='brand'?'A FAVOURITE BRAND':'A SHOE YOU KNOW'}</p><h3>${esc(w.kind==='category'?categoryNames[w.category]:w.query)}</h3><p>${esc(fitNames[w.fit])} · ${esc(w.size_system)} ${esc(w.size)} · up to ${euro(w.budget)}<br>${w.min_discount}% off or more · any colour</p><span class="watch-match">${w.matchCount?`${w.matchCount} size ${w.matchCount===1?'match':'matches'} at last check`:'Waiting for the right pair'}</span><div class="watch-actions"><button data-pause="${esc(w.id)}">${w.active?'Pause this watch':'Resume this watch'}</button><button data-delete="${esc(w.id)}">Remove</button></div></article>`).join(''):`<div class="empty-state"><h3>Good things are worth watching.</h3>Save your size, a shoe or a type of run.<br>We’ll keep the useful finds in one place.<br><button class="button button-dark" data-action="new-watch">Start your first watch <span>↗</span></button></div>`;
}
function renderSources(){
 $('#sources').innerHTML=data.sources.map(s=>{const stale=s.last_success&&Date.now()-Date.parse(s.last_success)>30*3600000;const status=s.adapter==='planned'?'planned':stale?'stale':s.status;const label:Record<string,string>={live:'CHECKED',planned:'ON THE LIST',error:'NEEDS ATTENTION',partial:'LIMITED COVERAGE',stale:'CHECK OVERDUE'};
  return `<article class="source-card"><div class="source-head"><h3>${esc(s.name)}</h3><span class="source-status ${status==='live'?'':status==='planned'?'planned':'partial'}">${label[status]??'FIRST CHECK PENDING'}</span></div><p>${s.adapter==='planned'?'An adapter is still needed. This shop is not included in current finds or alerts.':s.id==='elverys'?'Selected running-sale collection. Size-level stock; sizing system awaiting confirmation.':s.id==='runhub'?'Running footwear collection. Size-level stock; sizing system awaiting confirmation.':'Men’s and women’s running collections. Explicit UK size labels and size-level stock.'}</p><div class="source-detail"><span>${s.last_success?`${s.product_count} shoes · ${ago(s.last_success)}`:'No successful scan yet'}</span><span>${s.adapter==='planned'?'Not connected':'Product feed'}</span></div>${s.error?`<p>${esc(s.error)}</p>`:''}<a href="${esc(s.url)}" target="_blank" rel="noopener noreferrer">Visit the shop ↗</a></article>`;
 }).join('');
}
async function load(){data=await api('/api/dashboard');
 const live=data.sources.filter(s=>s.last_success&&Date.now()-Date.parse(s.last_success)<30*3600000).length;
 $('#scan-status').textContent=data.lastScan?`Last scan ${ago(data.lastScan).toLowerCase()}`:'Ready for its first check';
 $('#status-dot').classList.toggle('danger-dot',live===0);$('#coverage').textContent=`${live} sources checked · ${data.sources.length-live} awaiting a check or connection`;
 const brands=[...new Set(data.offers.map(o=>o.brand))].sort();const prev=$<HTMLSelectElement>('#filter-brand').value;
 $('#filter-brand').innerHTML='<option value="any">Any brand</option>'+brands.map(b=>`<option value="${esc(b)}">${esc(b)}</option>`).join('');if(brands.includes(prev))$<HTMLSelectElement>('#filter-brand').value=prev;
 const watchBrands=[...new Set([...brands,'ASICS','HOKA','BROOKS','SAUCONY','NIKE','ADIDAS','NEW BALANCE','ON','PUMA','MIZUNO'])].sort();$('#watch-brand').innerHTML=watchBrands.map(b=>`<option value="${esc(b)}">${esc(b)}</option>`).join('');
 $('#model-suggestions').innerHTML=[...new Set(data.offers.map(o=>o.title))].slice(0,150).map(t=>`<option value="${esc(t)}"></option>`).join('');
 $<HTMLInputElement>('#watch-email').value=data.user?.email??'';
 const hero=data.offers.find(o=>o.image&&o.discount>=25&&o.category==='daily')??data.offers.find(o=>o.image&&o.discount>=25);
 if(hero){$('#hero-shoe').innerHTML=`<img src="${esc(hero.image)}" alt="${esc(hero.title)}" width="450" height="320">`;$('#hero-live').textContent=`On the radar: ${hero.brand} · ${euro(hero.price)}`;}
 renderProducts();renderWatches();renderSources();
}
function selectKind(kind:string){
 $$('input[name="kind"]').forEach(input=>{const i=input as HTMLInputElement;i.checked=i.value===kind;i.closest('.watch-option')!.classList.toggle('selected',i.checked);});
 for(const name of ['category','brand','model'])$(`#${name}-field`).hidden=name!==kind;
}
function openWatch(offer?:Group,forceCategory=false){if(!data?.user){toast('Sign in to save a watch.');window.location.href='/signin-with-chatgpt?return_to=%2F';return;}
 $<HTMLFormElement>('#watch-form').reset();$('#watch-error').textContent='';$('#watch-step-one').hidden=false;$('#watch-step-two').hidden=true;selectKind(offer?'model':'category');$<HTMLInputElement>('#watch-email').value=data.user.email;
 if(offer){$<HTMLInputElement>('[name="model"]').value=offer.title;$<HTMLSelectElement>('[name="fit"]').value=['men','women'].includes(offer.fit)?offer.fit:'any';$<HTMLInputElement>('[name="budget"]').value=String(Math.ceil(offer.price/100));if(offer.size_system==='UK')$<HTMLSelectElement>('#watch-size').value=offer.sizes[0];}
 if(forceCategory)selectKind('category');$<HTMLDialogElement>('#watch-dialog').showModal();
}
const sizes=Array.from({length:27},(_,i)=>String(2+i*.5));$('#watch-size').innerHTML=sizes.map(s=>`<option value="${s}"${s==='8'?' selected':''}>UK ${s}</option>`).join('');$('#filter-size').innerHTML+=[...sizes].map(s=>`<option value="${s}">${s}</option>`).join('');
document.addEventListener('click',async event=>{const target=(event.target as HTMLElement).closest<HTMLElement>('button');if(!target)return;
 if(target.dataset.tab)tab(target.dataset.tab);
 if(target.dataset.action==='new-watch')openWatch();if(target.dataset.action==='category-watch')openWatch(undefined,true);
 if(target.dataset.close)$<HTMLDialogElement>(`#${target.dataset.close}`).close();
 if(target.dataset.category){category=target.dataset.category;shown=9;$$('[data-category]').forEach(b=>b.classList.toggle('active',b===target));renderProducts();}
 if(target.dataset.watchOffer)openWatch(data.offers.find(o=>o.id===target.dataset.watchOffer));
 if(target.dataset.pause||target.dataset.delete){const id=target.dataset.pause??target.dataset.delete;const w=data.watches.find(w=>w.id===id)!;target.setAttribute('disabled','');try{await api(`/api/watches/${id}`,{method:target.dataset.delete?'DELETE':'PATCH',body:target.dataset.delete?undefined:JSON.stringify({active:!w.active})});await load();toast(target.dataset.delete?'Watch removed.':w.active?'Watch paused.':'Back on your radar.');}catch(e){toast((e as Error).message);target.removeAttribute('disabled');}}
});
$$('input[name="kind"]').forEach(input=>input.addEventListener('change',()=>selectKind((input as HTMLInputElement).value)));
$('#watch-next').addEventListener('click',()=>{const kind=$<HTMLInputElement>('input[name="kind"]:checked').value;if(kind==='model'&&!$<HTMLInputElement>('[name="model"]').value.trim()){$<HTMLInputElement>('[name="model"]').focus();return;}$('#watch-step-one').hidden=true;$('#watch-step-two').hidden=false;$<HTMLSelectElement>('[name="fit"]').focus();});
$('#watch-back').addEventListener('click',()=>{$('#watch-step-one').hidden=false;$('#watch-step-two').hidden=true;});
$('#watch-form').addEventListener('submit',async event=>{event.preventDefault();const form=new FormData($<HTMLFormElement>('#watch-form'));const kind=String(form.get('kind'));const button=$<HTMLButtonElement>('#watch-submit');button.disabled=true;$('#watch-error').textContent='';try{await api('/api/watches',{method:'POST',body:JSON.stringify({kind,category:form.get('category'),query:kind==='brand'?form.get('brand'):kind==='model'?form.get('model'):'',fit:form.get('fit'),size:form.get('size'),budget:Math.round(Number(form.get('budget'))*100),min_discount:Number(form.get('min_discount')),consent:form.get('consent')==='on'})});$<HTMLDialogElement>('#watch-dialog').close();await load();tab('watches');toast('On your radar. Your watch is saved.');}catch(e){$('#watch-error').textContent=(e as Error).message;}finally{button.disabled=false;}});
$('#filter-toggle').addEventListener('click',()=>{const hidden=$('#size-filter').hidden;$('#size-filter').hidden=!hidden;$('#filter-toggle').setAttribute('aria-expanded',String(hidden));});
for(const id of ['filter-fit','filter-size','filter-brand','sort'])$(`#${id}`).addEventListener('change',()=>{shown=9;renderProducts();});
$('#clear-filters').addEventListener('click',()=>{for(const id of ['filter-fit','filter-size','filter-brand'])$<HTMLSelectElement>(`#${id}`).value='any';shown=9;renderProducts();});
$('#show-more').addEventListener('click',()=>{shown+=9;renderProducts();});
$('#feedback-open').addEventListener('click',()=>{$('#feedback-error').textContent='';$<HTMLDialogElement>('#feedback-dialog').showModal();});
$('#feedback-form').addEventListener('submit',async event=>{event.preventDefault();const form=$<HTMLFormElement>('#feedback-form'),values=new FormData(form),button=form.querySelector<HTMLButtonElement>('button[type="submit"]')!;button.disabled=true;try{await api('/api/feedback',{method:'POST',body:JSON.stringify({kind:values.get('kind'),message:values.get('message')})});form.reset();$<HTMLDialogElement>('#feedback-dialog').close();toast('Thanks. That’s saved for the club.');}catch(e){$('#feedback-error').textContent=(e as Error).message;}finally{button.disabled=false;}});
$$('dialog').forEach(dialog=>dialog.addEventListener('click',e=>{if(e.target===dialog){const r=dialog.getBoundingClientRect();const m=e as MouseEvent;if(m.clientX<r.left||m.clientX>r.right||m.clientY<r.top||m.clientY>r.bottom)(dialog as HTMLDialogElement).close();}}));
load().catch(()=>{$('#scan-status').textContent='The watch needs a moment';$('#coverage').textContent='Couldn’t load the latest check';$('#products').innerHTML='<div class="empty-state"><h3>A little pause between laps.</h3>We couldn’t load the latest finds. Please refresh in a moment.</div>';});
