import {mkdir} from 'node:fs/promises';
await mkdir('dist/client',{recursive:true});await mkdir('dist/vercel',{recursive:true});
const client=await Bun.build({entrypoints:['src/client.ts'],target:'browser',minify:true});if(!client.success)throw new Error(String(client.logs));await Bun.write('dist/client/app.js',client.outputs[0]);
const server=await Bun.build({entrypoints:['src/production.ts'],target:'bun',minify:true,outdir:'dist/vercel',naming:'app.js'});if(!server.success)throw new Error(String(server.logs));
console.log(`Built Vercel Bun application (${server.outputs[0].size} bytes); no database mutations during build.`);
