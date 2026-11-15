// Region describes the storefront, not a guaranteed parcel origin or arrival date.
export type ShopRegion = 'IE' | 'EU';
export function shopRegion(id:string):ShopRegion { return ['misterrunning','warehouse','21run'].includes(id)?'EU':'IE'; }
export function shopLocation(id:string) {const region=shopRegion(id);return {region,flag:region==='EU'?'🇪🇺':'🇮🇪',label:region==='EU'?'EU shop':'Irish shop'};}
