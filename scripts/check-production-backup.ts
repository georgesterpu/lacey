import {decryptBackup} from '../src/backup';
import {mkdir,writeFile} from 'node:fs/promises';
const base=process.env.APP_URL;if(!base||!process.env.CRON_SECRET||!process.env.BACKUP_ENCRYPTION_KEY)throw new Error('Backup verification credentials are required');
const denied=await fetch(new URL('/api/internal/backup',base),{method:'POST'});if(denied.status!==401)throw new Error('Anonymous backup request was not denied');
const response=await fetch(new URL('/api/internal/backup',base),{method:'POST',headers:{Authorization:`Bearer ${process.env.CRON_SECRET}`},signal:AbortSignal.timeout(90000)});if(!response.ok)throw new Error(`Backup returned HTTP ${response.status}`);
const bytes=new Uint8Array(await response.arrayBuffer()),data=await decryptBackup(bytes,process.env.BACKUP_ENCRYPTION_KEY);
await mkdir('.data/backups',{recursive:true,mode:0o700});await writeFile('.data/backups/verified-production.enc',bytes,{mode:0o600});
console.log(JSON.stringify({encrypted:true,verified:true,createdAt:data.createdAt,rows:Object.fromEntries(Object.entries(data.tables).map(([table,rows])=>[table,rows.length]))}));
