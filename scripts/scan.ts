export {};
const url=process.env.APP_URL??'http://localhost:3000';
const response=await fetch(`${url}/api/internal/scan`,{method:'POST',headers:{Authorization:`Bearer ${process.env.CRON_SECRET??''}`}});if(!response.ok)throw new Error(`Scan HTTP ${response.status}: ${await response.text()}`);console.log(await response.json());
