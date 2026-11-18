import {mkdir} from 'node:fs/promises';
const revision=process.env.LACEY_RELEASE_REVISION??process.env.VERCEL_GIT_COMMIT_SHA??Bun.spawnSync(['git','rev-parse','HEAD']).stdout.toString().trim();
if(!/^[a-f0-9]{40}$/.test(revision))throw Error('Build requires an exact Git revision');
await mkdir('dist/client',{recursive:true});await mkdir('dist/vercel',{recursive:true});
const client=await Bun.build({entrypoints:['src/client.ts'],target:'browser',minify:true});if(!client.success)throw new Error(String(client.logs));await Bun.write('dist/client/app.js',client.outputs[0]);
const server=await Bun.build({entrypoints:['src/production.ts'],target:'bun',minify:true,outdir:'dist/vercel',naming:'app.js',define:{'process.env.LACEY_BUILD_REVISION':JSON.stringify(revision)}});if(!server.success)throw new Error(String(server.logs));
console.log(`Built Vercel Bun application (${server.outputs[0].size} bytes); no database mutations during build.`);
