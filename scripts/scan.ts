export {};
const url=process.env.APP_URL??'http://localhost:3000';
const response=await fetch(`${url}/api/internal/scan`,{method:'POST'});if(!response.ok)throw new Error(`Scan HTTP ${response.status}: ${await response.text()}`);console.log(await response.json());
