import {remoteClient,resultRows} from '../src/database';
const exportFile=process.argv[2];if(!exportFile)throw new Error('Provide the private Sites member-data export');
const backup=await Bun.file(exportFile).json();if(backup.format!==1||backup.project_id!=='appgprj_6af9b149ab688191995bd56827b4d13c')throw new Error('Unexpected source database');
const tables=['watches','subscribers','feedback','digest_jobs','notifications','recommendation_receipts','email_confirmations','delivery_budget'];
for(const t of tables){const source=backup.tables[t];if(!source||source.has_more||source.model_projection.truncated)throw new Error(`Incomplete source export: ${t}`);}
// The initial migration has no historical jobs. A populated outbox would also
// require its referenced scan records; never silently discard those references.
if(backup.tables.digest_jobs.rows.length)throw new Error('Export referenced scan records before importing historical jobs');
const client=remoteClient({TURSO_DATABASE_URL:process.env.TURSO_DATABASE_URL,TURSO_AUTH_TOKEN:process.env.TURSO_AUTH_TOKEN}),tx=await client.transaction('write');
try{const counts:Record<string,number>={};
 for(const table of tables){const target=await tx.execute(`SELECT count(*) n FROM ${table}`);if(Number(target.rows[0]?.n)!==0)throw new Error(`Import destination not empty: ${table}`);
  const allowed=new Set(resultRows<{name:string}>(await tx.execute(`PRAGMA table_info(${table})`)).map(c=>c.name));
  for(const row of backup.tables[table].rows){const keys=Object.keys(row);if(keys.some(k=>!allowed.has(k)))throw new Error('Unexpected source column');await tx.execute({sql:`INSERT INTO ${table} (${keys.map(k=>`"${k}"`).join(',')}) VALUES(${keys.map(()=>'?').join(',')})`,args:keys.map(k=>row[k])});}
  const verified=await tx.execute(`SELECT count(*) n FROM ${table}`);counts[table]=Number(verified.rows[0]?.n);if(counts[table]!==backup.tables[table].rows.length)throw new Error(`Import count mismatch: ${table}`);
 }
 await tx.commit();console.log(JSON.stringify({imported:counts}));
}finally{tx.close();client.close();}
