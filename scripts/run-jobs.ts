// Deterministic orchestration, executed directly by Bun. The API is idempotent
// by scheduled slot; every retry resumes stored state. No model or browser.
import { mkdir, writeFile } from "node:fs/promises";
interface Scan {
  runId: string;
  status: string;
  reports?: {status:string}[];
}
interface Catalogue {
  done: boolean;
  status: string;
  retryAfterMs?: number;
}
interface Dispatch {
  plan: { planned: number; done: boolean; error?: string };
  delivery: { status: string; remaining: number; sent: number };
}
interface Health {
  run?: { id: string; status?: string };
  stale: boolean;
  checks: unknown;
  delivery: unknown;
  emailReady: boolean;
}
const base = process.env.APP_URL;
const secret = process.env.CRON_SECRET;
if (!base || !secret)
  throw new Error("APP_URL and CRON_SECRET must be configured");

const direct = process.env.DIRECT_COLLECTION === 'true'
  ? await import('./collection-worker') : null;
async function post<T>(path: string, body: object = {}): Promise<T> {
  if(direct && (path==='/api/internal/scan'||path==='/api/internal/catalogue'))
    return await direct.collect(path,body) as T;
  for (let attempt = 1; attempt <= 3; attempt++) {
    let response: Response | undefined;
    try {
      response = await fetch(new URL(path, base), {
        method: "POST",
        headers: {
          Authorization: `Bearer ${secret}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(240000),
      });
    } catch {
      if (attempt === 3)
        throw new Error(`${path}: connection failed after 3 attempts`);
    }
    if (response?.ok) return response.json() as Promise<T>;
    if (response) {
      await response.body?.cancel();
      if (response.status < 500 || attempt === 3)
        throw new Error(`${path}: HTTP ${response.status}`);
    }
    console.warn(`${path}: temporary request failure; retry ${attempt}/2`);
    await Bun.sleep(attempt * 5000);
  }
  throw new Error(`${path}: request attempts exhausted`);
}
const resumeRun = process.env.RESUME_RUN_ID;
if (
  resumeRun &&
  (process.env.CATALOGUE_ONLY !== "true" || !/^[a-f0-9-]{36}$/.test(resumeRun))
)
  throw new Error(
    "An existing scan can only be resumed in catalogue-only mode with a valid scan ID",
  );
let scan: Scan | undefined = resumeRun
  ? { runId: resumeRun, status: "complete" }
  : undefined;
const catalogueOnly = process.env.CATALOGUE_ONLY === "true";
if (catalogueOnly && !scan) {
  // A catalogue worker needs a durable namespace, not a new source scan. The
  // latter can be running independently and must never be started/retried here.
  const response = await fetch(new URL("/api/health", base), {
    signal: AbortSignal.timeout(15000),
  });
  if (!response.ok)
    throw new Error("Cannot read the existing scan for catalogue collection");
  const health = (await response.json()) as Health;
  if (!health.run?.id)
    throw new Error("Run a source scan before starting catalogue collection");
  scan = { runId: health.run.id, status: health.run.status ?? "running" };
}
for (let attempt = 0; !catalogueOnly && attempt < 3; attempt++) {
  try {
    scan = await post<Scan>("/api/internal/scan");
    console.log(
      JSON.stringify({
        stage: "scan",
        runId: scan.runId,
        status: scan.status,
        reports: scan.reports,
      }),
    );
    if (["complete", "partial"].includes(scan.status)) break;
  } catch (error) {
    console.error(
      error instanceof Error ? error.message : "Scan request failed",
    );
    if (attempt === 2) throw error;
  }
  await Bun.sleep((attempt + 1) * 15000);
}
if (!scan || (!catalogueOnly && !["complete", "partial"].includes(scan.status)))
  throw new Error("No completed source scan; email dispatch withheld");

// Catalogue workers never dispatch subscriber emails. Slow collection cannot
// hold up the independent scan, delivery and backup job.
if (catalogueOnly) {
  // Invocation budgets bound requests, not catalogue coverage. Each call resumes
  // a persistent cursor; only a finished catalogue replaces the public snapshot.
  const deadline = Date.now() + 90 * 60000;
  let catalogueDone = false,
    catalogueFailed = false;
  for (let step = 0; step < 2000 && Date.now() < deadline; step++) {
    const result = await post<Catalogue>("/api/internal/catalogue", {
      runId: scan.runId,
      sourceId:process.env.CATALOGUE_SOURCE??'21run',
    });
    console.log(JSON.stringify({ stage: "catalogue", ...result }));
    if(result.status==='paused'){
      console.log('Retailer is paused; no import performed and no email requested. The shop status retains its blocking reason.');
      process.exit(0);
    }
    if (result.done) {
      catalogueDone = true;
      catalogueFailed = result.status === "failed";
      break;
    }
    await Bun.sleep(
      Math.min(
        60000,
        Math.max(
          200,
          result.retryAfterMs ?? (result.status === "busy" ? 5000 : 200),
        ),
      ),
    );
  }
  if (catalogueFailed) throw new Error("Catalogue failed; inspect shop checks");
  console.log(
    catalogueDone
      ? "Catalogue refresh complete; email delivery was not requested"
      : "Catalogue checkpoint retained; collection will resume on the next worker run",
  );
  process.exit(0);
}

let complete = false;
for (let page = 0; page < 200; page++) {
  if(direct)console.log(JSON.stringify({stage:'preflight',...await direct.preflight(scan.runId)}));
  const result = await post<Dispatch>("/api/internal/dispatch", {
    runId: scan.runId,
  });
  console.log(
    JSON.stringify({
      stage: "dispatch",
      page,
      planned: result.plan.planned,
      planningDone: result.plan.done,
      delivery: result.delivery,
    }),
  );
  if (result.plan.error) throw new Error(result.plan.error);
  if (result.delivery.status === "daily_limit") {
    console.log("Daily email budget reached; remaining jobs stay held");
    complete = true;
    break;
  }
  if (result.plan.done && result.delivery.remaining === 0) {
    complete = true;
    break;
  }
  await Bun.sleep(result.delivery.sent ? 300 : 5000);
}
if (!complete)
  throw new Error(
    "Dispatch page budget exhausted; stored jobs can resume safely",
  );
const response = await fetch(new URL("/api/health", base), {
  signal: AbortSignal.timeout(30000),
});
if (!response.ok) throw new Error("Health readback failed");
const health = (await response.json()) as Health;
console.log(
  JSON.stringify({
    stage: "verified",
    run: health.run,
    checks: health.checks,
    delivery: health.delivery,
    emailReady: health.emailReady,
  }),
);
if (health.run?.id !== scan.runId || health.stale)
  throw new Error("Scan readback is stale or inconsistent");

// Keep customer data recoverable independently of deployment artifacts.
const backup = await fetch(new URL("/api/internal/backup", base), {
  method: "POST",
  headers: { Authorization: `Bearer ${secret}` },
  signal: AbortSignal.timeout(90000),
});
if (!backup.ok) throw new Error(`Encrypted backup: HTTP ${backup.status}`);
const bytes = new Uint8Array(await backup.arrayBuffer());
if (new TextDecoder().decode(bytes.slice(0, 8)) !== "LACEY01\n")
  throw new Error("Invalid encrypted backup response");
// Bun implements this module itself; no Node process is involved. Keep explicit
// private creation permissions (covered by the isolated runner integration test).
await mkdir(".data/backups", { recursive: true, mode: 0o700 });
await writeFile(`.data/backups/lacey-${scan.runId}.enc`, bytes, {
  mode: 0o600,
});
console.log(JSON.stringify({ stage: "backed_up", bytes: bytes.byteLength }));
if (scan.status === "partial"&&(!scan.reports||scan.reports.some(r=>r.status==='failed')))
  throw new Error(
    "A shop failed validation; healthy sources were processed. Inspect source checks.",
  );
if(scan.reports?.some(r=>['cached','unavailable'].includes(r.status)))console.log('Some shop refreshes are delayed. Browsing snapshots retain their original timestamps and expiry; unavailable sources are excluded from email matching.');
