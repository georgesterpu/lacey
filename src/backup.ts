import type {Client,InStatement} from '@libsql/client/web';
import {resultRows} from './database';
// Recollectable product catalogues are excluded. All member data, consent,
// suppression tokens, receipts and referenced run/job records are preserved.
export const backupTables=['sources','scan_runs','watches','subscribers','feedback','digest_jobs','notifications','recommendation_receipts','email_confirmations','delivery_budget','app_state','schema_migrations'] as const;
export interface Backup {format:1;createdAt:string;tables:Record<string,Record<string,unknown>[]>;}
function keyBytes(value:string){if(!/^[a-f0-9]{64}$/i.test(value))throw new Error('BACKUP_ENCRYPTION_KEY must be 32 bytes encoded as hex');return Uint8Array.from(value.match(/../g)!,s=>parseInt(s,16));}
export async function snapshot(client:Client):Promise<Backup>{const results=await client.batch(backupTables.map(table=>`SELECT * FROM ${table}`),'read');return {format:1,createdAt:new Date().toISOString(),tables:Object.fromEntries(backupTables.map((t,i)=>[t,resultRows<Record<string,unknown>>(results[i])]))};}
export async function encryptBackup(backup:Backup,keyHex:string){const key=await crypto.subtle.importKey('raw',keyBytes(keyHex),'AES-GCM',false,['encrypt']),iv=crypto.getRandomValues(new Uint8Array(12));const zipped=new Uint8Array(await new Response(new Blob([JSON.stringify(backup)]).stream().pipeThrough(new CompressionStream('gzip'))).arrayBuffer());const ciphertext=new Uint8Array(await crypto.subtle.encrypt({name:'AES-GCM',iv,additionalData:new TextEncoder().encode('lacey-backup-v1')},key,zipped));const header=new TextEncoder().encode('LACEY01\n');const bytes=new Uint8Array(header.length+iv.length+ciphertext.length);bytes.set(header);bytes.set(iv,header.length);bytes.set(ciphertext,header.length+iv.length);return bytes;}
export async function decryptBackup(bytes:Uint8Array,keyHex:string):Promise<Backup>{if(new TextDecoder().decode(bytes.slice(0,8))!=='LACEY01\n')throw new Error('Unknown backup format');const key=await crypto.subtle.importKey('raw',keyBytes(keyHex),'AES-GCM',false,['decrypt']);const zipped=await crypto.subtle.decrypt({name:'AES-GCM',iv:bytes.slice(8,20),additionalData:new TextEncoder().encode('lacey-backup-v1')},key,bytes.slice(20));const json=await new Response(new Blob([zipped]).stream().pipeThrough(new DecompressionStream('gzip'))).text();const data=JSON.parse(json) as Backup;if(data.format!==1||!data.tables||backupTables.some(t=>!Array.isArray(data.tables[t])))throw new Error('Invalid backup manifest');return data;}
export async function restore(client:Client,backup:Backup){
 const tx=await client.transaction('write');try{
  // A restore always goes to an empty, independently provisioned database.
  for(const table of backupTables){if(table==='schema_migrations')continue;const rows=await tx.execute(`SELECT count(*) n FROM ${table}`);if(Number(rows.rows[0]?.n)!==0)throw new Error(`Restore destination is not empty: ${table}`);}
  const migrations=resultRows<{tag:string;checksum:string}>(await tx.execute('SELECT tag,checksum FROM schema_migrations ORDER BY tag'));
  const source=backup.tables.schema_migrations.map(r=>({tag:r.tag,checksum:r.checksum})).sort((a,b)=>String(a.tag).localeCompare(String(b.tag)));
  if(JSON.stringify(migrations)!==JSON.stringify(source))throw new Error('Restore schema does not match backup');
  let rows=0;
  for(const table of backupTables){if(table==='schema_migrations')continue;
   const columns=new Set((await tx.execute(`PRAGMA table_info(${table})`)).rows.map(r=>String(r.name)));
   const statements:InStatement[]=[];
   for(const original of backup.tables[table]){let row={...original};if(Object.keys(row).some(k=>!columns.has(k)))throw new Error(`Unknown backup column in ${table}`);
    if(table==='sources')row={...row,live_snapshot_id:null,status:row.adapter==='planned'?'planned':'stale',last_success:null,product_count:0};
    if(table==='scan_runs')row={...row,status:'failed',attempts:0,planning_done:1};
    if(table==='digest_jobs'&&['queued','sending'].includes(String(row.status)))row={...row,status:'suppressed',lease_until:null,error:'Restored backup; stale deliveries suppressed'};
    if(table==='recommendation_receipts'&&row.status==='reserved')row.status='uncertain';
    const keys=Object.keys(row);statements.push({sql:`INSERT INTO ${table} (${keys.map(k=>`"${k}"`).join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,args:keys.map(k=>row[k] as string|number|null)});rows++;
   }
   for(let i=0;i<statements.length;i+=100)await tx.batch(statements.slice(i,i+100));
  }
  await tx.commit();return {rows};
 }finally{tx.close();}
}
