import {expect,test} from 'bun:test';
import {shoeCards,shoeIdentity} from '../src/shoe-identity';
import type {Offer} from '../src/types';
const shoe:Offer={id:'amphibian:1',source_id:'amphibian',product_id:'1',title:'ASICS Sonic Blast 3 Men’s Running Shoes',brand:'ASICS',category:'daily',fit:'men',size_system:'UK',size:'9',colour:'',price:10000,reference_price:15000,currency:'EUR',image:'',url:'https://example.test/1',available:1,checked_at:new Date().toISOString()};
test('retailer punctuation and spaces merge; generation, department, GTX and width stay separate',()=>{
 expect(shoeIdentity(shoe).key).toBe(shoeIdentity({...shoe,title:'ASICS SonicBlast 3 Mens',source_id:'runhub',product_id:'another'}).key);
 for(const change of [{title:'ASICS SonicBlast 31 Mens'},{title:'ASICS SonicBlast 4 Mens'},{title:'ASICS SonicBlast 3 GTX Mens'},{title:'ASICS SonicBlast 3 Wide Mens'},{fit:'women'},{fit:'kids'}])expect(shoeIdentity({...shoe,...change}).key).not.toBe(shoeIdentity(shoe).key);
 expect(shoeIdentity({...shoe,brand:'Unknown'}).confidence).toBe('source');
 expect(shoeIdentity({...shoe,title:'adidas Runfalcon 5 Boys Running Shoes',brand:'ADIDAS',fit:'kids'}).key).toBe(shoeIdentity({...shoe,title:'Adidas Runfalcon 5 Lightweight Kids Running Shoes',brand:'ADIDAS',fit:'kids'}).key);
 expect(shoeIdentity({...shoe,title:'Hoka Clifton 10 Womens',brand:'Hoka One One',fit:'women'}).key).toBe(shoeIdentity({...shoe,title:'HOKA Clifton 10 Women’s Running Shoes',brand:'HOKA',fit:'women'}).key);
});
test('one card keeps each size’s own cheapest price and variant link; unknown units never convert',()=>{
 const cheap={...shoe,id:'runhub:2',source_id:'runhub',product_id:'2',price:9000,url:'https://example.test/cheap'};
 const cards=shoeCards([shoe,{...shoe,id:'amphibian:3',size:'8',url:'https://example.test/8'},cheap]);expect(cards).toHaveLength(1);expect(cards[0].options).toHaveLength(2);expect(cards[0].options.find(o=>o.size==='9')!.url).toBe(cheap.url);
 expect(shoeCards([shoe,{...cheap,size_system:'unknown'}])[0].options).toHaveLength(2);
});
