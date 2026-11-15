import type { Env, Watch } from './types';
import { claim, digest, randomToken } from './identity';
export const emailReady=(env:Env)=>!!(env.RESEND_API_KEY&&env.EMAIL_FROM&&env.APP_URL);
export async function sendConfirmation(env:Env,watch:Pick<Watch,'id'|'email'>) {
 if(!emailReady(env))return 'unavailable';
 const existing=await env.DB.prepare('SELECT expires_at FROM email_confirmations WHERE watch_id=?').bind(watch.id).first<{expires_at:string}>();
 if(existing&&existing.expires_at>new Date().toISOString())return 'pending';
 // Only one confirmation per address per day, across devices. Never log addresses.
 if(!await claim(env,`confirm:${await digest(watch.email)}:${new Date().toISOString().slice(0,10)}`))return 'limited';
 const token=randomToken(),now=new Date().toISOString();
 await env.DB.prepare('INSERT INTO email_confirmations(watch_id,token_hash,expires_at,sent_at) VALUES(?,?,?,?) ON CONFLICT(watch_id) DO UPDATE SET token_hash=excluded.token_hash,expires_at=excluded.expires_at,sent_at=excluded.sent_at').bind(watch.id,await digest(token),new Date(Date.now()+86400000).toISOString(),now).run();
 try {
  const link=`${env.APP_URL}/confirm-email?token=${token}`;
  const response=await fetch('https://api.resend.com/emails',{method:'POST',headers:{Authorization:`Bearer ${env.RESEND_API_KEY}`,'Content-Type':'application/json','Idempotency-Key':`confirm:${watch.id}:${now.slice(0,10)}`},body:JSON.stringify({from:env.EMAIL_FROM,to:[watch.email],subject:'Confirm your Brave Runners shoe alert',text:`You requested running-shoe sale alerts. Confirm this watch here: ${link}\n\nThe link expires in 24 hours. If you did not request this, ignore this email. No sale emails will be sent without your confirmation.`}),signal:AbortSignal.timeout(15000)});
  if(!response.ok)throw new Error('Confirmation delivery failed');return 'sent';
 }catch{await env.DB.prepare('DELETE FROM email_confirmations WHERE watch_id=?').bind(watch.id).run();return 'failed';}
}
