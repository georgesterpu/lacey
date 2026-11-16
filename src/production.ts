import {handle} from './server';
import {remoteClient,databaseAdapter} from './database';
import {snapshot,encryptBackup} from './backup';
import type {Client} from '@libsql/client/web';
import {runtimeEnv} from './runtime-env';
import clientCode from '../dist/client/app.js' with {type:'text'};
let client:Client|undefined;
console.info('Lacey runtime',{bun:Bun.version});
function connection(){return client??=remoteClient({TURSO_DATABASE_URL:process.env.TURSO_DATABASE_URL,TURSO_AUTH_TOKEN:process.env.TURSO_AUTH_TOKEN});}
export async function appFetch(request:Request){
 try{
  const url=new URL(request.url),db=connection();
  if(url.pathname==='/api/internal/backup'){
   if(!process.env.CRON_SECRET||request.headers.get('Authorization')!==`Bearer ${process.env.CRON_SECRET}`)return new Response('Unauthorized',{status:401});
   if(request.method!=='POST')return new Response('Use POST',{status:405});
   const backup=await snapshot(db),bytes=await encryptBackup(backup,process.env.BACKUP_ENCRYPTION_KEY??'');
   if(bytes.byteLength>4_000_000)throw new Error('Backup exceeds function response limit; use the direct backup script');
   await db.execute({sql:"INSERT INTO app_state(key,value) VALUES('last_backup',?) ON CONFLICT(key) DO UPDATE SET value=excluded.value",args:[backup.createdAt]});
   return new Response(bytes,{headers:{'Content-Type':'application/octet-stream','Cache-Control':'no-store','Content-Disposition':`attachment; filename="lacey-${backup.createdAt.slice(0,10)}.enc"`}});
  }
  const env=runtimeEnv(databaseAdapter(db),url.origin,process.env);
  return await handle(request,env,clientCode);
 }catch(error){console.error('Lacey request failed',{type:error instanceof Error?error.name:'Unknown'});return Response.json({error:'Temporarily unavailable. Please try again shortly.'},{status:503,headers:{'Cache-Control':'no-store'}});}
}
