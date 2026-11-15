import type { Env } from './types';
export async function alreadyRecommended(env:Env,emailHash:string,key:string,jobId?:string){const row=await env.DB.prepare('SELECT status,job_id FROM recommendation_receipts WHERE email_hash=? AND shoe_key=?').bind(emailHash,key).first<{status:string;job_id:string|null}>();return !!row&&(row.status==='sent'||row.job_id!==jobId);}
export async function reserveRecommendation(env:Env,emailHash:string,key:string,jobId:string){await env.DB.prepare("INSERT INTO recommendation_receipts(email_hash,shoe_key,status,job_id,created_at) VALUES(?,?,'reserved',?,?) ON CONFLICT(email_hash,shoe_key) DO NOTHING").bind(emailHash,key,jobId,new Date().toISOString()).run();return !await alreadyRecommended(env,emailHash,key,jobId);}
export async function releaseUnsentRecommendations(env:Env,jobId:string){
 // A known HTTP rejection or no provider attempt is safe to release. A crash or
 // timeout can mean the provider accepted the message: keep that receipt uncertain.
 const job=await env.DB.prepare('SELECT attempts,error FROM digest_jobs WHERE id=?').bind(jobId).first<{attempts:number;error:string|null}>();
 if(!job?.attempts||job.error?.startsWith('Email provider HTTP'))await env.DB.prepare("DELETE FROM recommendation_receipts WHERE job_id=? AND status='reserved'").bind(jobId).run();
 else await env.DB.prepare("UPDATE recommendation_receipts SET status='uncertain' WHERE job_id=? AND status='reserved'").bind(jobId).run();
}
