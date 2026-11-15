import {mkdir,chmod,writeFile,readFile} from 'node:fs/promises';
import {remoteClient} from '../src/database';
import {migrate} from '../src/migrations';
import {snapshot,encryptBackup,decryptBackup,restore} from '../src/backup';
const client=remoteClient({TURSO_DATABASE_URL:process.env.TURSO_DATABASE_URL,TURSO_AUTH_TOKEN:process.env.TURSO_AUTH_TOKEN}),command=process.argv[2];
const journal=await Bun.file('drizzle/meta/_journal.json').json();const migrations=await Promise.all(journal.entries.map(async({tag}:{tag:string})=>({tag,sql:await Bun.file(`drizzle/${tag}.sql`).text()})));
try{
 if(command==='migrate'){
  const tables=await client.execute("SELECT name FROM sqlite_schema WHERE type='table' AND name='watches'");
  if(tables.rows.length){const backup=await snapshot(client);await saveBackup(backup);}
  console.log(JSON.stringify(await migrate(client,migrations)));
 }else if(command==='backup')console.log(JSON.stringify(await saveBackup(await snapshot(client))));
 else if(command==='restore'){
  if(process.argv[4]!=='--empty-database')throw new Error('Restore requires a new empty database and --empty-database');
  const data=await decryptBackup(new Uint8Array(await readFile(process.argv[3])),process.env.BACKUP_ENCRYPTION_KEY??'');
  console.log(JSON.stringify(await restore(client,data)));
 }else throw new Error('Choose migrate, backup, or restore');
}finally{client.close();}
async function saveBackup(data:Awaited<ReturnType<typeof snapshot>>){const bytes=await encryptBackup(data,process.env.BACKUP_ENCRYPTION_KEY??'');await mkdir('.data/backups',{recursive:true,mode:0o700});const path=`.data/backups/lacey-${data.createdAt.replace(/[:.]/g,'-')}.enc`;await writeFile(path,bytes,{mode:0o600});await chmod(path,0o600);return {path,bytes:bytes.byteLength};}
