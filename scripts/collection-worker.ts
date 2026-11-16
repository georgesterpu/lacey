import { remoteClient, databaseAdapter } from "../src/database";
import { retryTransient } from "../src/transient";
import{prepareDelivery}from '../src/preflight';
import { scan } from "../src/scan";
import { advanceCatalogue } from "../src/catalogue-job";
// The trusted Bun scheduler owns ingestion. No email credentials or member
// delivery code is used here, and no Vercel request-duration budget applies.
const client = remoteClient({ ...process.env, timeoutMs: 90000 });
const env = { DB: databaseAdapter(client) };
process.once("exit", () => client.close());
export const preflight=(runId:string)=>prepareDelivery(env,runId);
export async function collect(path: string, input: object) {
  if (path === "/api/internal/scan") return scan(env);
  if (path === "/api/internal/catalogue") {
    const runId = String((input as { runId?: string }).runId ?? "");
    if (!/^[a-f0-9-]{36}$/.test(runId))
      throw new Error("Invalid catalogue run");
    const sourceId=String((input as {sourceId?:string}).sourceId??'21run');
    return retryTransient(() => advanceCatalogue(env, runId,sourceId));
  }
  throw new Error("Worker only accepts collection operations");
}
