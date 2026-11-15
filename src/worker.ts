import { handle } from './server';
import type { Env } from './types';
import clientCode from '../dist/client/app.js' with {type:'text'};
export default {async fetch(request:Request,env:Env){try{return await handle(request,env,clientCode);}catch(e){console.error('Request failed',e instanceof Error?e.message:'Unknown error');return Response.json({error:'Something went wrong. Please try again.'},{status:500});}}};
