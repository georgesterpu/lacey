// Optional read-only diagnosis for a caller-supplied 21RUN EU product URL.
// bun scripts/probe-eu-shops.ts https://21run.com/eu/<product>
import {twentyOneProduct} from '../src/twentyone';
const url=process.argv[2];
if(!url)throw new Error('Supply a 21RUN EU product URL');
const offers=await twentyOneProduct(url,new Date().toISOString());
console.log(JSON.stringify(offers,null,2));
