import {test,expect} from 'bun:test';
import {lifestyleVariant,lifestyleListing,lifestyleSizes,lifestyleLink} from '../src/lifestyle';
test('Lifestyle uses selected variant stock and leaves unlabelled sizes source-specific',async()=>{const html=await Bun.file('fixtures/lifestyle-variant.html').text(),url='https://www.lifestylesports.com/ie/variation?pid=12069220&dwvar_12069220_LSSSize=7';const o=lifestyleVariant(html,url,'now');expect(o).toMatchObject({source_id:'lifestyle',product_id:'12069220',size:'7',size_system:'unknown',price:13500,reference_price:18000,available:1,fit:'men'});expect(()=>lifestyleVariant(html,url.replace('LSSSize=7','LSSSize=8'),'now')).toThrow('selected size mismatch');expect(()=>lifestyleVariant(html.replace('content="EUR"','content="USD"'),url,'now')).toThrow('currency');});
test('Lifestyle discovers every sale tile on the allowed entry page, beyond the old five-product cap',()=>{
 const tiles=Array.from({length:8},(_,i)=>`<div class="product-tile"><span data-value="%22price_type%22%3A%22${i===7?'full':'sale'}%22"></span><a class="name-link" href="https://www.lifestylesports.com/ie/shoe-${i}.html?cgid=running">Shoe</a></div>`).join('');
 expect(lifestyleListing(tiles)).toHaveLength(7);
 expect(lifestyleListing(tiles).at(-1)).toBe('https://www.lifestylesports.com/ie/shoe-6.html');
 expect(()=>lifestyleListing('<p>Contract changed</p>')).toThrow('contract');
});
test('Lifestyle keeps all numeric size choices, excludes unrelated swatches and rejects unapproved URLs',()=>{
 const link=(size:number)=>`https://www.lifestylesports.com/ie/variation?pid=12069220&amp;dwvar_12069220_LSSSize=${size}`;
 const choices=Array.from({length:12},(_,i)=>`<li><a class="swatchanchor" href="${link(i+1)}">${i+1}</a></li>`).join('');
 const links=lifestyleSizes(`<ul class="swatches lsssize">${choices}</ul><a class="swatchanchor" href="https://other.test/colour">Colour</a>`);
 expect(links).toHaveLength(12);expect(links.at(-1)).toEndWith('LSSSize=12');
 expect(()=>lifestyleLink(link(7).replaceAll('&amp;','&')+'&redirect=evil')).toThrow();
 expect(()=>lifestyleLink('https://other.test/ie/shoe.html')).toThrow();
 expect(()=>lifestyleSizes('<p>No size contract</p>')).toThrow('choices');
});
