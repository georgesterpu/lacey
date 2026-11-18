import { appendFile } from 'node:fs/promises';

// Resolve without production database/email credentials. A broken or unreleased
// main branch must never become the scheduled production writer.
export async function liveRevision(base: string, repository: string, token?: string) {
  const health = await fetch(new URL('/api/health', base), {
    cache: 'no-store', signal: AbortSignal.timeout(15000),
  });
  if (!health.ok) throw Error(`Live release lookup: HTTP ${health.status}`);
  const { revision } = await health.json() as { revision?: string };
  if (!revision || !/^[a-f0-9]{40}$/.test(revision))
    throw Error('The live site does not identify a released revision; no production job started');
  if (!/^[\w.-]+\/[\w.-]+$/.test(repository)) throw Error('Invalid repository');
  const checks = await fetch(`https://api.github.com/repos/${repository}/actions/workflows/quality.yml/runs?head_sha=${revision}&per_page=1`, {
    headers: { ...(token ? { Authorization: `Bearer ${token}` } : {}), Accept: 'application/vnd.github+json' },
    signal: AbortSignal.timeout(15000),
  });
  if (!checks.ok) throw Error(`Release checks lookup: HTTP ${checks.status}`);
  const { workflow_runs } = await checks.json() as { workflow_runs: { head_sha: string; status: string; conclusion: string }[] };
  const run = workflow_runs[0];
  if (run?.head_sha !== revision || run.status !== 'completed' || run.conclusion !== 'success')
    throw Error('The live revision has no passing quality checks; no production job started');
  return revision;
}
if (import.meta.main) {
  const { APP_URL, GITHUB_REPOSITORY, LACEY_SOURCE_REPOSITORY, GITHUB_TOKEN, GITHUB_OUTPUT } = process.env;
  const repository = LACEY_SOURCE_REPOSITORY ?? GITHUB_REPOSITORY;
  if (!APP_URL || !repository || !GITHUB_OUTPUT) throw Error('Release lookup configuration missing');
  // A private operations repo reads public source checks without sharing its
  // repository token across the boundary. Same-repo private installs may use it.
  const revision = await liveRevision(APP_URL, repository, repository === GITHUB_REPOSITORY ? GITHUB_TOKEN : undefined);
  await appendFile(GITHUB_OUTPUT, `revision=${revision}\n`);
  console.log(`Production worker pinned to tested live revision ${revision}`);
}
