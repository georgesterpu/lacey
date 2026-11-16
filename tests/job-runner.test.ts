import { test, expect } from "bun:test";
import { mkdtemp, rm, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

const runId = "3531f0f4-4479-4d88-ab08-2ae54b289e1c";
async function run(
  response: (path: string) => Response,
  catalogueOnly = "true",
  resumeRun = runId,
) {
  const directory = await mkdtemp(join(tmpdir(), "lacey-runner-"));
  const paths: string[] = [];
  const server = Bun.serve({
    port: 0,
    fetch(request) {
      const path = new URL(request.url).pathname;
      paths.push(path);
      return response(path);
    },
  });
  try {
    const child = Bun.spawn(
      [
        process.execPath,
        fileURLToPath(new URL("../scripts/run-jobs.ts", import.meta.url)),
      ],
      {
        cwd: directory,
        env: {
          PATH: "/lacey-test-no-executables",
          APP_URL: server.url.href,
          CRON_SECRET: "test-only",
          CATALOGUE_ONLY: catalogueOnly,
          RESUME_RUN_ID: resumeRun,
        },
        stdout: "pipe",
        stderr: "pipe",
      },
    );
    const [code, out, err] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    const path = join(directory, `.data/backups/lacey-${runId}.enc`);
    const file = Bun.file(path);
    const backup = (await file.exists())
      ? { text: await file.text(), mode: (await stat(path)).mode & 0o777 }
      : null;
    return { code, out, err, paths, backup };
  } finally {
    server.stop(true);
    await rm(directory, { recursive: true, force: true });
  }
}

test("the GitHub Bun runner resumes a checkpoint, retries HTTP 503 and finishes without email dispatch", async () => {
  let calls = 0;
  const result = await run(() => {
    calls++;
    if (calls === 1) return new Response("", { status: 503 });
    if (calls === 2)
      return Response.json({
        done: false,
        status: "retrying",
        retryAfterMs: 1,
      });
    return Response.json({
      done: true,
      status: "complete",
      checked: 1500,
      rejected: 1,
    });
  });
  expect(result.code).toBe(0);
  expect(result.paths).toEqual(Array(3).fill("/api/internal/catalogue"));
  expect(result.out).toContain('"rejected":1');
  expect(result.err).toContain("temporary request failure");
}, 15000);

test("the runner still fails on permanent catalogue errors and never dispatches recovery emails", async () => {
  const result = await run(() =>
    Response.json({
      done: true,
      status: "failed",
      error: "21RUN robots.txt disallows this request",
    }),
  );
  expect(result.code).toBe(1);
  expect(result.paths).toEqual(["/api/internal/catalogue"]);
  expect(result.err).toContain("Catalogue failed");
});

test("the runner refuses to resume historical scans with email delivery enabled", async () => {
  const result = await run(() => {
    throw new Error("No request should be made");
  }, "false");
  expect(result.code).toBe(1);
  expect(result.paths).toEqual([]);
  expect(result.err).toContain("catalogue-only");
});

test("the Bun runner completes the scheduled pipeline and writes a private backup without Node on PATH", async () => {
  const result = await run(
    (path) => {
      if (path === "/api/internal/scan")
        return Response.json({ runId, status: "complete" });
      if (path === "/api/internal/catalogue")
        return Response.json({ done: true, status: "complete" });
      if (path === "/api/internal/dispatch")
        return Response.json({
          plan: { planned: 0, done: true },
          delivery: { status: "complete", remaining: 0, sent: 0 },
        });
      if (path === "/api/health")
        return Response.json({
          run: { id: runId },
          stale: false,
          emailReady: true,
        });
      if (path === "/api/internal/backup")
        return new Response("LACEY01\nfixture-ciphertext");
      throw new Error("Unexpected endpoint");
    },
    "false",
    "",
  );
  expect(result.code).toBe(0);
  expect(result.paths).toEqual([
    "/api/internal/scan",
    "/api/internal/dispatch",
    "/api/health",
    "/api/internal/backup",
  ]);
  expect(result.backup).toEqual({
    text: "LACEY01\nfixture-ciphertext",
    mode: 0o600,
  });
});
