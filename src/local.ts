import { Database } from 'bun:sqlite';
import { mkdirSync, readFileSync } from 'node:fs';
import { handle } from './server';
import type { DB, Statement, Env } from './types';
mkdirSync('.data',{recursive:true});const sqlite=new Database('.data/brave.sqlite');sqlite.exec('PRAGMA journal_mode=WAL; PRAGMA foreign_keys=ON;');
sqlite.exec('CREATE TABLE IF NOT EXISTS local_migrations(name TEXT PRIMARY KEY)');
const journal=await Bun.file('drizzle/meta/_journal.json').json();
for(const {tag} of journal.entries){if(!sqlite.query('SELECT name FROM local_migrations WHERE name=?').get(tag)){sqlite.transaction(()=>{sqlite.exec(readFileSync(`drizzle/${tag}.sql`,'utf8'));sqlite.query('INSERT INTO local_migrations VALUES(?)').run(tag);})();}}
function statement(sql:string,values:unknown[]=[]):Statement {return {bind:(...args)=>statement(sql,args),all:async<T>()=>({results:sqlite.query(sql).all(...values as any[]) as T[]}),first:async<T>()=>(sqlite.query(sql).get(...values as any[])??null) as T|null,run:async()=>sqlite.query(sql).run(...values as any[])};}
export const db:DB={prepare:sql=>statement(sql),batch:async statements=>{sqlite.exec('BEGIN');try{const results=[];for(const s of statements)results.push(await s.run());sqlite.exec('COMMIT');return results;}catch(e){sqlite.exec('ROLLBACK');throw e;}}};
const build=await Bun.build({entrypoints:['src/client.ts'],target:'browser',minify:false});if(!build.success)throw new Error(String(build.logs));const clientCode=await build.outputs[0].text();
const env:Env={DB:db,RESEND_API_KEY:process.env.RESEND_API_KEY,EMAIL_FROM:process.env.EMAIL_FROM,APP_URL:process.env.APP_URL,CRON_SECRET:process.env.CRON_SECRET,DAILY_EMAIL_LIMIT:process.env.DAILY_EMAIL_LIMIT};
const server=Bun.serve({port:Number(process.env.PORT??3000),hostname:'127.0.0.1',idleTimeout:255,async fetch(request){try{return await handle(request,env,clientCode);}catch(e){console.error(e);return Response.json({error:'Something went wrong. Please try again.'},{status:500});}}});console.log(`Shoehoo: ${server.url}`);
