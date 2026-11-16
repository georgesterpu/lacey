import {test,expect} from 'bun:test';

const runId='3531f0f4-4479-4d88-ab08-2ae54b289e1c';
async function run(response:(path:string)=>Response,catalogueOnly='true'){
 const paths:string[]=[];
 const server=Bun.serve({port:0,fetch(request){const path=new URL(request.url).pathname;paths.push(path);return response(path);}});
 try{
  const child=Bun.spawn(['node','scripts/run-jobs.mjs'],{env:{PATH:process.env.PATH,APP_URL:server.url.href,CRON_SECRET:'test-only',CATALOGUE_ONLY:catalogueOnly,RESUME_RUN_ID:runId},stdout:'pipe',stderr:'pipe'});
  const [code,out,err]=await Promise.all([child.exited,new Response(child.stdout).text(),new Response(child.stderr).text()]);
  return {code,out,err,paths};
 }finally{server.stop(true);}
}

test('the GitHub Node runner resumes a checkpoint, retries HTTP 503 and finishes without email dispatch',async()=>{
 let calls=0;
 const result=await run(()=>{
  calls++;
  if(calls===1)return new Response('',{status:503});
  if(calls===2)return Response.json({done:false,status:'retrying',retryAfterMs:1});
  return Response.json({done:true,status:'complete',checked:1500,rejected:1});
 });
 expect(result.code).toBe(0);
 expect(result.paths).toEqual(Array(3).fill('/api/internal/catalogue'));
 expect(result.out).toContain('"rejected":1');
 expect(result.err).toContain('temporary request failure');
},15000);

test('the runner still fails on permanent catalogue errors and never dispatches recovery emails',async()=>{
 const result=await run(()=>Response.json({done:true,status:'failed',error:'21RUN robots.txt disallows this request'}));
 expect(result.code).toBe(1);
 expect(result.paths).toEqual(['/api/internal/catalogue']);
 expect(result.err).toContain('Catalogue failed');
});

test('the runner refuses to resume historical scans with email delivery enabled',async()=>{
 const result=await run(()=>{throw new Error('No request should be made');},'false');
 expect(result.code).toBe(1);
 expect(result.paths).toEqual([]);
 expect(result.err).toContain('catalogue-only');
});
