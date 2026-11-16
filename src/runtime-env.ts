import type {DB,Env} from './types';
export function runtimeEnv(DB:DB,origin:string,values:Record<string,string|undefined>):Env {
 const sending=values.VERCEL_ENV==='production'&&values.EMAIL_ENABLED==='true';
 return {DB,APP_URL:values.APP_URL??origin,CRON_SECRET:values.CRON_SECRET,DAILY_EMAIL_LIMIT:values.DAILY_EMAIL_LIMIT??'50',RESEND_API_KEY:sending?values.RESEND_API_KEY:undefined,EMAIL_FROM:sending?values.EMAIL_FROM:undefined,REQUIRE_PREFLIGHT:values.VERCEL_ENV==='production'};
}
