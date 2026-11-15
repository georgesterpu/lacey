import type { Env } from './types';
const cookieName='brave_device';
export async function digest(value:string) { return [...new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(value)))].map(n=>n.toString(16).padStart(2,'0')).join(''); }
export function randomToken() {return [...crypto.getRandomValues(new Uint8Array(32))].map(n=>n.toString(16).padStart(2,'0')).join('');}
export async function device(request:Request) {
 const token=request.headers.get('Cookie')?.match(/(?:^|;\s*)brave_device=([a-f0-9]{64})(?:;|$)/)?.[1]??randomToken();
 return {owner:`device:${await digest(token)}`,cookie:`${cookieName}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=31536000${new URL(request.url).protocol==='https:'?'; Secure':''}`};
}
// A database claim is atomic even when two Worker instances handle a request at once.
export async function claim(env:Env,key:string,value=randomToken()) {
 await env.DB.prepare('INSERT INTO app_state(key,value) VALUES(?,?) ON CONFLICT(key) DO NOTHING').bind(key,value).run();
 return (await env.DB.prepare('SELECT value FROM app_state WHERE key=?').bind(key).first<{value:string}>())?.value===value;
}
export async function rateLimit(env:Env,request:Request,action:string,limit:number) {
 const address=request.headers.get('CF-Connecting-IP')??request.headers.get('x-forwarded-for')?.split(',')[0]??'unknown';
 const key=`rate:${action}:${await digest(address)}:${new Date().toISOString().slice(0,13)}`;
 for(let i=0;i<limit;i++)if(await claim(env,`${key}:${i}`))return true;
 return false;
}
