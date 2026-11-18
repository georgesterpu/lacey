// Read-only production incident evidence; no database or email credentials.
import {retailerPage} from '../src/retailer-http';
import {misterListing} from '../src/misterrunning';
const url='https://www.misterrunning.com/en/mens-running-shoes/?p=31';
try{
 const html=await retailerPage(url);
 console.log('MisterRunning pagination',{
  requested:url,
  next:[...html.matchAll(/<a\b[^>]*rel="next"[^>]*>/g)].map(m=>{const raw=m[0].match(/href="([^"]+)"/)?.[1]??'';const u=new URL(raw.replaceAll('&amp;','&'),url);return{path:u.pathname,page:u.searchParams.get('p'),keys:[...u.searchParams.keys()]}}),
  pager:html.match(/<ul class="pagination[^>]*>([\s\S]*?)<\/ul>/)?.[1]?.replace(/<[^>]+>/g,' ').replace(/\s+/g,' ').slice(0,150)
 });
 const page=misterListing(html,url);console.log('Parsed pagination',{next:page.next,products:page.products.length});
}catch(error){console.log('MisterRunning error',(error as Error).message)}
const data=await(await fetch('https://lacey.january.ie/api/catalogue')).json();
for(const offer of data.offers.filter((o:any)=>o.source_id==='lifestyle').slice(0,3)){
 const u=new URL(offer.image);if(u.origin!=='https://www.lifestylesports.com')throw Error('Unapproved image origin');
 const r=await fetch(u,{signal:AbortSignal.timeout(15000),redirect:'manual'});
 const bytes=await r.arrayBuffer();console.log('Lifestyle image',{url:u.href,status:r.status,type:r.headers.get('Content-Type'),bytes:bytes.byteLength});
 if([401,403,406,429].includes(r.status))break;
}
await using view=new Bun.WebView({width:390,height:900,backend:{type:'chrome',path:process.env.BUN_CHROME_PATH,url:false}});
await view.navigate('https://lacey.january.ie');
for(let n=0;n<100&&!(await view.evaluate('document.querySelectorAll(".product-card").length>0'));n++)await Bun.sleep(100);
await view.evaluate(`(()=>{const s=document.querySelector('#filter-region');s.value='shop:lifestyle';s.dispatchEvent(new Event('change',{bubbles:true}));document.querySelector('.product-card img')?.scrollIntoView({block:'center'});})()`);
await Bun.sleep(5000);
console.log('Lifestyle browser images',await view.evaluate('[...document.querySelectorAll(".product-card img")].slice(0,3).map(i=>({src:i.currentSrc,complete:i.complete,width:i.naturalWidth,top:i.getBoundingClientRect().top}))'));
