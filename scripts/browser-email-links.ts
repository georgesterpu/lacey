// Native browser form submission against a caller-selected test database.
// Creates only synthetic records directly in the DB; it sends no emails.
import {strict as assert} from 'node:assert';
import {mkdir} from 'node:fs/promises';
import {remoteClient} from '../src/database';
import {digest,randomToken} from '../src/identity';
const base=process.env.APP_URL??'http://127.0.0.1:3007';
const client=remoteClient({TURSO_DATABASE_URL:process.env.TURSO_DATABASE_URL,TURSO_AUTH_TOKEN:process.env.TURSO_AUTH_TOKEN});
const id=crypto.randomUUID(),owner=`browser-email:${id}`,email=`browser-email-${id}@example.test`,token=randomToken(),hash=await digest(email),now=new Date().toISOString();
try{
 await client.batch([
 {sql:"INSERT INTO watches(id,owner_id,email,kind,query,category,fit,size_system,size,budget,created_at,consent_at,unsubscribe_token) VALUES(?,?,?,'category','','any','women','UK','6',12000,?,?,?)",args:[id,owner,email,now,now,randomToken()]},
 {sql:'INSERT INTO email_confirmations VALUES(?,?,?,?)',args:[id,await digest(token),new Date(Date.now()+3600000).toISOString(),now]}
 ],'write');
 await mkdir('screenshots',{recursive:true});
 await using view=new Bun.WebView({width:900,height:900,backend:{type:'chrome',path:process.env.BUN_CHROME_PATH,url:false}});
 await view.navigate(`${base}/confirm-email?token=${token}`);
 assert.equal(await view.evaluate('document.characterSet'),'UTF-8');
 assert.ok(await view.evaluate('document.body?.innerText?.includes("lacey 😊") && document.body?.innerText?.includes("we’ll keep an eye out")'));
 assert.equal(Number((await client.execute({sql:'SELECT email_verified FROM watches WHERE id=?',args:[id]})).rows[0].email_verified),0);
 await Bun.write('screenshots/confirmation-before.png',await view.screenshot());
 await view.click('form button');await until(view,'document.body?.innerText?.includes("You’re on the list")');
 assert.equal(Number((await client.execute({sql:'SELECT email_verified FROM watches WHERE id=?',args:[id]})).rows[0].email_verified),1);
 await Bun.write('screenshots/confirmation-success.png',await view.screenshot());console.log('Confirmation: UTF-8 text, native form POST, stored verification, success page.');
 const person=(await client.execute({sql:'SELECT unsubscribe_token,unsubscribed FROM subscribers WHERE email_hash=?',args:[hash]})).rows[0];
 await view.navigate(`${base}/unsubscribe-all?token=${person.unsubscribe_token}`);assert.equal(Number(person.unsubscribed),0);await view.click('form button');await until(view,'document.body?.innerText?.includes("You’re unsubscribed")');
 assert.equal(Number((await client.execute({sql:'SELECT active FROM watches WHERE id=?',args:[id]})).rows[0].active),0);
 assert.equal(Number((await client.execute({sql:'SELECT unsubscribed FROM subscribers WHERE email_hash=?',args:[hash]})).rows[0].unsubscribed),1);
 await Bun.write('screenshots/unsubscribe-success.png',await view.screenshot());console.log('Unsubscribe: native form POST, paused watch, subscriber suppression, readable success page.');
}finally{await client.batch([{sql:'DELETE FROM watches WHERE id=?',args:[id]},{sql:'DELETE FROM subscribers WHERE email_hash=?',args:[hash]}],'write');client.close();}
async function until(view:InstanceType<typeof Bun.WebView>,expression:string){const end=Date.now()+15000;while(Date.now()<end){if(await view.evaluate(expression))return;await Bun.sleep(100);}throw new Error('Email link browser flow did not reach success page');}
