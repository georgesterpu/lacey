import { mkdir, copyFile } from 'node:fs/promises';
await mkdir('dist/client',{recursive:true});await mkdir('dist/server',{recursive:true});await mkdir('dist/.openai',{recursive:true});
const client=await Bun.build({entrypoints:['src/client.ts'],target:'browser',minify:true});if(!client.success)throw new Error(String(client.logs));await Bun.write('dist/client/app.js',client.outputs[0]);
const server=await Bun.build({entrypoints:['src/worker.ts'],target:'browser',minify:true,outdir:'dist/server',naming:'index.js'});if(!server.success)throw new Error(String(server.logs));
await copyFile('.openai/hosting.json','dist/.openai/hosting.json');console.log(`Built client (${client.outputs[0].size} bytes) and Worker (${server.outputs[0].size} bytes)`);
