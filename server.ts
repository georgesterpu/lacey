// Vercel's Bun preset routes all requests through this one stateless server.
import {appFetch} from './dist/vercel/app.js';
Bun.serve({fetch:appFetch,idleTimeout:255});
