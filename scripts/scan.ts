export {};
const url=process.env.APP_URL??'http://localhost:3000';const headers:Record<string,string>={};if(process.env.SCAN_SECRET)headers.Authorization=`Bearer ${process.env.SCAN_SECRET}`;
const response=await fetch(`${url}/api/internal/scan`,{method:'POST',headers});if(!response.ok)throw new Error(`Scan HTTP ${response.status}: ${await response.text()}`);console.log(await response.json());
