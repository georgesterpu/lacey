import {test,expect,spyOn} from 'bun:test';
import {readFileSync,writeFileSync,statSync} from 'node:fs';
import {warehouseProduct} from '../src/warehouse';
import {retailerPage} from '../src/retailer-http';

test('Warehouse selects English/Ireland once, retains its private session and browses subsequent shoes with GET',async()=>{
 const product=await Bun.file('fixtures/warehouse-product.html').text();
 let submissions=0,products=0,jar='';
 const mock=spyOn(Bun,'spawn').mockImplementation(((args:string[])=>{
  const url=new URL(args.at(-1)!),cookie=args.includes('--cookie')?args[args.indexOf('--cookie')+1]:'';
  let body='User-agent: *\nAllow: /';
  if(url.hostname==='ie.sportsdirect.com')expect(cookie).toBe('');
  else {
   expect(cookie).toBeTruthy();if(jar)expect(cookie).toBe(jar);jar=cookie;
   expect(statSync(cookie).mode&0o777).toBe(0o600);
   if(args.includes('--data')){
    expect(url.pathname).toBe('/');expect(args[args.indexOf('--data')+1]).toBe('lang=en&vat=IE');
    submissions++;writeFileSync(cookie,'country=IE');body='<option value="IE" selected>Ireland</option>';
   }else if(url.pathname.endsWith('.html')){
    products++;body=readFileSync(cookie,'utf8')==='country=IE'?product:product.replace('value="IE" selected','value="DE" selected');
   }
  }
  return {exited:Promise.resolve(0),stdout:new Response(body+'\n200').body,stderr:new Response('').body} as unknown as ReturnType<typeof Bun.spawn>;
 }) as typeof Bun.spawn);
 try{
  for(const code of ['FIRST','SECOND'])expect((await warehouseProduct(`https://www.runningwarehouse.eu/Shoe/descpage-${code}-EN.html`,new Date().toISOString())).some(o=>o.available)).toBe(true);
  expect(submissions).toBe(1);expect(products).toBe(2);
  await retailerPage('https://ie.sportsdirect.com/robots.txt');
 }finally{mock.mockRestore();}
},15000);
