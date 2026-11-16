import {mkdir,writeFile} from 'node:fs/promises';
// This runner contains no model SDK, prompt, agent or browser automation.
// The API is idempotent by scheduled slot; every retry resumes stored state.
const base=process.env.APP_URL;
const secret=process.env.CRON_SECRET;
if(!base||!secret)throw new Error('APP_URL and CRON_SECRET must be configured');
const sleep=ms=>new Promise(resolve=>setTimeout(resolve,ms));
async function post(path,body){
 for(let attempt=1;attempt<=3;attempt++){
  let response;
  try{response=await fetch(new URL(path,base),{method:'POST',headers:{Authorization:`Bearer ${secret}`,'Content-Type':'application/json'},body:JSON.stringify(body??{}),signal:AbortSignal.timeout(240000)});}
  catch{if(attempt===3)throw new Error(`${path}: connection failed after 3 attempts`);}
  if(response?.ok)return response.json();
  if(response){await response.body?.cancel();if(response.status<500||attempt===3)throw new Error(`${path}: HTTP ${response.status}`);}
  console.warn(`${path}: temporary request failure; retry ${attempt}/2`);
  await sleep(attempt*5000);
 }
}
const resumeRun=process.env.RESUME_RUN_ID;
if(resumeRun&&(process.env.CATALOGUE_ONLY!=='true'||!/^[a-f0-9-]{36}$/.test(resumeRun)))throw new Error('An existing scan can only be resumed in catalogue-only mode with a valid scan ID');
let scan=resumeRun?{runId:resumeRun,status:'complete'}:undefined;
for(let attempt=0;!resumeRun&&attempt<3;attempt++){
 try{scan=await post('/api/internal/scan');console.log(JSON.stringify({stage:'scan',runId:scan.runId,status:scan.status,reports:scan.reports}));if(['complete','partial'].includes(scan.status))break;}catch(error){console.error(error.message);if(attempt===2)throw error;}
 await sleep((attempt+1)*15000);
}
if(!scan||!['complete','partial'].includes(scan.status))throw new Error('No completed source scan; email dispatch withheld');
// The full catalogue advances in checkpointed batches, independently of request
// duration. No arbitrary shoe/size cap; a retry resumes the same scan and cursor.
let catalogueDone=false,catalogueFailed=false;
for(let step=0;step<2000;step++){
 const result=await post('/api/internal/catalogue',{runId:scan.runId});
 console.log(JSON.stringify({stage:'catalogue',...result}));
 if(result.done){catalogueDone=true;catalogueFailed=result.status==='failed';break;}
 await sleep(Math.min(60000,Math.max(200,result.retryAfterMs??(result.status==='busy'?5000:200))));
}
if(!catalogueDone)throw new Error('Catalogue time budget exhausted; checkpoint retained');
if(process.env.CATALOGUE_ONLY==='true'){
 if(catalogueFailed)throw new Error('Catalogue failed; inspect shop checks');
 console.log('Catalogue refresh complete; email delivery was not requested');
 process.exit(0);
}
let complete=false;
for(let page=0;page<200;page++){
 const result=await post('/api/internal/dispatch',{runId:scan.runId});
 console.log(JSON.stringify({stage:'dispatch',page,planned:result.plan.planned,planningDone:result.plan.done,delivery:result.delivery}));
 if(result.plan.error)throw new Error(result.plan.error);
 if(result.delivery.status==='daily_limit'){console.log('Daily email budget reached; remaining jobs stay held');complete=true;break;}
 if(result.plan.done&&result.delivery.remaining===0){complete=true;break;}
 await sleep(result.delivery.sent?300:5000);
}
if(!complete)throw new Error('Dispatch page budget exhausted; stored jobs can resume safely');
const response=await fetch(new URL('/api/health',base),{signal:AbortSignal.timeout(30000)});if(!response.ok)throw new Error('Health readback failed');const health=await response.json();
console.log(JSON.stringify({stage:'verified',run:health.run,checks:health.checks,delivery:health.delivery,emailReady:health.emailReady}));
if(health.run?.id!==scan.runId||health.stale)throw new Error('Scan readback is stale or inconsistent');
// Keep customer data recoverable independently of deployment artifacts.
const backup=await fetch(new URL('/api/internal/backup',base),{method:'POST',headers:{Authorization:`Bearer ${secret}`},signal:AbortSignal.timeout(90000)});
if(!backup.ok)throw new Error(`Encrypted backup: HTTP ${backup.status}`);
const bytes=new Uint8Array(await backup.arrayBuffer());if(new TextDecoder().decode(bytes.slice(0,8))!=='LACEY01\n')throw new Error('Invalid encrypted backup response');
await mkdir('.data/backups',{recursive:true});await writeFile(`.data/backups/lacey-${scan.runId}.enc`,bytes,{mode:0o600});
console.log(JSON.stringify({stage:'backed_up',bytes:bytes.byteLength}));
if(scan.status==='partial'||catalogueFailed)throw new Error('A shop failed validation; healthy sources were processed. Inspect source checks.');
