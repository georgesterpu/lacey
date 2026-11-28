import {test,expect} from 'bun:test';
import {retailerPage,RetailerRequestError} from '../src/retailer-http';

test('a failed retailer connection is retryable transport failure, not a bad product record',async()=>{
 const original=globalThis.fetch;
 globalThis.fetch=(async(input:unknown)=>{
  if(String(input).endsWith('/robots.txt'))return new Response('User-agent: *\nAllow: /');
  throw new TypeError('Connection closed');
 }) as unknown as typeof fetch;
 try{
  try{await retailerPage('https://www.misterrunning.com/en/network-fixture.html');throw Error('Expected request failure');}
  catch(error){expect(error).toBeInstanceOf(RetailerRequestError);expect(error).toMatchObject({retryable:true,message:'Retailer network request failed (www.misterrunning.com; TypeError)'});}
 }finally{globalThis.fetch=original;}
});
