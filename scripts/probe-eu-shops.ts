export {};
// Read-only investigation. No database access, subscriptions or email delivery.
// BUN_CHROME_PATH=/path/to/chrome bun scripts/probe-eu-shops.ts
const chrome=process.env.BUN_CHROME_PATH;
if(!chrome)throw new Error('Set BUN_CHROME_PATH to an installed Chromium executable');
for(const shop of ['21run','misterrunning'] as const){
 const url=shop==='21run'?'https://21run.com/eu/asics-novablast-6-men-1011c243-001':'https://www.misterrunning.com/en/asics-novablast-6-mens-running-shoes-foggy-teal-1011c243-401.html';
 const direct=await fetch(url,{signal:AbortSignal.timeout(15000)});
 console.log(JSON.stringify({shop,transport:'server-fetch',status:direct.status}));await direct.body?.cancel();
 if(shop==='21run'){for(const path of ['catalog/delivery','sizeselector/sizeselector']){const r=await fetch(`https://21run.com/eu/rest/eu/V1/${path}/1011C243-001`,{signal:AbortSignal.timeout(15000)});const d=r.ok?await r.json() as {products?:unknown[]}:null;console.log(JSON.stringify({shop,transport:'server-api',path,status:r.status,variants:d?.products?.length}));await r.body?.cancel().catch(()=>{});}}
 await using view=new Bun.WebView({width:1200,height:900,backend:{type:'chrome',path:chrome,url:false}});
 await view.navigate(url);
 const deadline=Date.now()+15000;
 while(Date.now()<deadline){if(await view.evaluate(shop==='21run'?`document.title.includes('Novablast')`:`!!document.querySelector('button[data-ean][data-uk]')`))break;await Bun.sleep(200);}
 const identity=await view.evaluate(`({url:location.href,title:document.title,canonical:document.querySelector('link[rel="canonical"]')?.href})`);
 const data=shop==='21run'?await view.evaluate(`(async()=>{
  const r=await fetch('/eu/rest/eu/V1/sizeselector/sizeselector/1011C243-001');
  if(!r.ok)return {status:r.status};const d=await r.json();
  return {status:r.status,reportedCount:d.total_products,actualVariantCount:d.products?.length,variants:d.products?.map(p=>({sku:p.sku,parent:p.parent_sku,colour:p.color,available:p.is_available,stock:p.stock,sizes:p.sizes.map(s=>({system:s.attribute_code,value:s.label.content}))}))};
 })()`):await view.evaluate(`({variants:[...document.querySelectorAll('button[data-ean][data-uk]')].map(e=>({ean:e.dataset.ean,UK:e.dataset.uk,EU:e.dataset.eu,US:e.dataset.usa,status:e.innerText,classes:e.className})),countryContext:document.body.innerText.includes('Italia')?'Italy default; Ireland not verified':'unverified'})`);
 console.log(JSON.stringify({shop,transport:'browser',identity,data}));
}
