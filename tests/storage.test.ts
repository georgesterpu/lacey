import {test,expect,afterEach} from 'bun:test';
import {createClient,type Client} from '@libsql/client';
import {databaseAdapter,remoteClient} from '../src/database';
import {migrate,type Migration} from '../src/migrations';
import {snapshot,encryptBackup,decryptBackup,restore} from '../src/backup';
import {runtimeEnv} from '../src/runtime-env';
import {emailReady} from '../src/email';
import {handle} from '../src/server';
const clients:Client[]=[];afterEach(()=>clients.splice(0).forEach(c=>c.close()));
async function fresh(){const client=createClient({url:':memory:',intMode:'number'});clients.push(client);await client.execute('PRAGMA foreign_keys=ON');const journal=await Bun.file('drizzle/meta/_journal.json').json();const migrations:Migration[]=await Promise.all(journal.entries.map(async({tag}:{tag:string})=>({tag,sql:await Bun.file(`drizzle/${tag}.sql`).text()})));await migrate(client,migrations);return {client,DB:databaseAdapter(client),migrations};}
async function member(client:Client){const now=new Date().toISOString();await client.batch([
 {sql:"INSERT INTO watches(id,owner_id,email,kind,query,category,fit,size_system,size,budget,created_at,consent_at,unsubscribe_token,email_verified) VALUES('w','owner','member@example.test','category','','any','women','UK','6',12000,?,?,'watch-token',1)",args:[now,now]},
 "INSERT INTO subscribers VALUES('email-hash','member@example.test','stop-token',0)",
 {sql:"INSERT INTO feedback VALUES('feedback','owner','idea','Keep my feedback please',?)",args:[now]},
 {sql:"INSERT INTO recommendation_receipts(email_hash,shoe_key,status,created_at) VALUES('email-hash','model:ASICS:women:31','sent',?)",args:[now]}
 ],'write');}
test('libSQL adapter rolls back the entire batch when one statement fails',async()=>{const {DB}=await fresh();await expect(DB.batch([DB.prepare("INSERT INTO feedback VALUES('first','owner','idea','test','now')"),DB.prepare('INSERT INTO missing_table VALUES(1)')])).rejects.toThrow();expect((await DB.prepare('SELECT count(*) n FROM feedback').first<{n:number}>())!.n).toBe(0);});
test('checked migrations preserve member data across redeploys and additive schema upgrades',async()=>{const {client,DB,migrations}=await fresh();await member(client);expect((await migrate(client,migrations)).applied).toBe(0);expect((await DB.prepare('SELECT count(*) n FROM watches').first<{n:number}>())!.n).toBe(1);
 await expect(migrate(client,[{...migrations[0],sql:migrations[0].sql+'\n-- edited'},...migrations.slice(1)])).rejects.toThrow('Applied migration changed');
 const upgrade=[...migrations,{tag:'test_additive',sql:'ALTER TABLE watches ADD COLUMN reminder_mode TEXT DEFAULT \'once\''}];expect((await migrate(client,upgrade)).applied).toBe(1);expect((await DB.prepare('SELECT email,reminder_mode FROM watches').first())).toEqual({email:'member@example.test',reminder_mode:'once'});
});
test('encrypted backup restores consent, feedback, tokens and sent-shoe receipts to a fresh database',async()=>{
 const source=await fresh();await member(source.client);await source.client.execute("INSERT INTO email_identities(owner_id,email,verified_at,delivery_state) VALUES('owner','member@example.test','2026-11-15T00:00:00.000Z','verified')");const backup=await snapshot(source.client),key='ab'.repeat(32),bytes=await encryptBackup(backup,key);expect(new TextDecoder().decode(bytes)).not.toContain('member@example.test');await expect(decryptBackup(bytes,'cd'.repeat(32))).rejects.toThrow();
 const decoded=await decryptBackup(bytes,key),destination=await fresh();expect((await restore(destination.client,decoded)).rows).toBeGreaterThanOrEqual(4);
 expect(await destination.DB.prepare('SELECT email,email_verified,consent_at,unsubscribe_token FROM watches').first()).toEqual(await source.DB.prepare('SELECT email,email_verified,consent_at,unsubscribe_token FROM watches').first());expect(await destination.DB.prepare('SELECT * FROM feedback').first()).toEqual(await source.DB.prepare('SELECT * FROM feedback').first());expect(await destination.DB.prepare('SELECT * FROM recommendation_receipts').first()).toEqual(await source.DB.prepare('SELECT * FROM recommendation_receipts').first());expect(await destination.DB.prepare('SELECT * FROM email_identities').first()).toEqual(await source.DB.prepare('SELECT * FROM email_identities').first());expect((await destination.DB.prepare('PRAGMA foreign_key_check').all()).results).toHaveLength(0);
 await expect(restore(destination.client,decoded)).rejects.toThrow('not empty');
 const response=await handle(new Request('https://shoe.test/unsubscribe-all?token=stop-token',{method:'POST'}),{DB:destination.DB},'');expect(response.status).toBe(200);expect((await destination.DB.prepare('SELECT unsubscribed FROM subscribers').first<{unsubscribed:number}>())!.unsubscribed).toBe(1);
});
test('preview cannot send emails even if email credentials accidentally reach its environment',async()=>{const {DB}=await fresh(),values={VERCEL_ENV:'preview',EMAIL_ENABLED:'true',RESEND_API_KEY:'test-only',EMAIL_FROM:'test@example.test'};expect(emailReady(runtimeEnv(DB,'https://preview.test',values))).toBe(false);expect(emailReady(runtimeEnv(DB,'https://shoe.test',{...values,VERCEL_ENV:'production'}))).toBe(true);expect(emailReady(runtimeEnv(DB,'https://shoe.test',{...values,VERCEL_ENV:'production',EMAIL_ENABLED:'false'}))).toBe(false);expect(()=>remoteClient({TURSO_DATABASE_URL:'file:local.sqlite',TURSO_AUTH_TOKEN:'test-only'})).toThrow('remote TLS');});
