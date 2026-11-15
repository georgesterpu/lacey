import type {Client} from '@libsql/client/web';
export interface Migration {tag:string;sql:string;}
export async function checksum(sql:string){return Array.from(new Uint8Array(await crypto.subtle.digest('SHA-256',new TextEncoder().encode(sql)))).map(v=>v.toString(16).padStart(2,'0')).join('');}
export async function migrate(client:Client,migrations:Migration[]){
 const tx=await client.transaction('write');let applied=0;
 try{
  const foreignKeys=await tx.execute('PRAGMA foreign_keys');if(Number(foreignKeys.rows[0]?.foreign_keys)!==1)throw new Error('Foreign key enforcement is required');
  await tx.execute('CREATE TABLE IF NOT EXISTS schema_migrations(tag TEXT PRIMARY KEY,checksum TEXT NOT NULL,applied_at TEXT NOT NULL)');
  const existing=await tx.execute('SELECT tag,checksum FROM schema_migrations ORDER BY applied_at,tag');
  const known=new Map(existing.rows.map(row=>[String(row.tag),String(row.checksum)]));
  for(const tag of known.keys())if(!migrations.some(m=>m.tag===tag))throw new Error(`Database has an unknown migration: ${tag}`);
  let gap=false;
  for(const m of migrations){const hash=await checksum(m.sql);if(known.has(m.tag)){if(gap||known.get(m.tag)!==hash)throw new Error(`Applied migration changed or reordered: ${m.tag}`);continue;}gap=true;
   for(const sql of m.sql.split('--> statement-breakpoint').map(s=>s.trim()).filter(Boolean))await tx.execute(sql);
   await tx.execute({sql:'INSERT INTO schema_migrations VALUES(?,?,?)',args:[m.tag,hash,new Date().toISOString()]});applied++;
  }
  await tx.commit();return {applied,total:migrations.length};
 }finally{tx.close();}
}
