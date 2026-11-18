import { test, expect, afterEach } from 'bun:test';
import { liveRevision } from '../scripts/live-revision';
const original = globalThis.fetch, revision = 'a'.repeat(40);
afterEach(() => { globalThis.fetch = original; });
test('production workers select the live tested revision, independent of newer main code', async () => {
  const urls: string[] = [];
  globalThis.fetch = (async (input, init) => {
    const url = String(input); urls.push(url);
    if (url === 'https://lacey.test/api/health') {
      expect(init?.headers).toBeUndefined();
      return Response.json({ revision, run: { status: 'failed' } });
    }
    expect(url).toBe(`https://api.github.com/repos/owner/lacey/actions/workflows/quality.yml/runs?head_sha=${revision}&per_page=1`);
    return Response.json({ workflow_runs: [{ head_sha: revision, status: 'completed', conclusion: 'success' }] });
  }) as typeof fetch;
  expect(await liveRevision('https://lacey.test', 'owner/lacey', 'test-only')).toBe(revision);
  expect(urls).toHaveLength(2);
});
test('missing, failed, pending or mismatched release evidence stops the production worker', async () => {
  for (const run of [undefined, { head_sha: revision, status: 'completed', conclusion: 'failure' }, { head_sha: revision, status: 'in_progress' }, { head_sha: 'b'.repeat(40), status: 'completed', conclusion: 'success' }]) {
    globalThis.fetch = (async input => String(input).includes('/api/health')
      ? Response.json({ revision }) : Response.json({ workflow_runs: run ? [run] : [] })) as typeof fetch;
    await expect(liveRevision('https://lacey.test', 'owner/lacey', 'test-only')).rejects.toThrow('no passing quality');
  }
  globalThis.fetch = (async () => Response.json({ revision: 'main' })) as unknown as typeof fetch;
  await expect(liveRevision('https://lacey.test', 'owner/lacey', 'test-only')).rejects.toThrow('no production job');
});
test('every scheduled database writer checks out the tested live revision before receiving credentials',async()=>{
 for(const file of ['shoehoo-checks','retention']){
   const workflow=Bun.YAML.parse(await Bun.file(`.github/workflows/${file}.yml`).text()) as any;
   expect(workflow.jobs['live-release'].uses).toBe('./.github/workflows/live-release.yml');
   for(const job of Object.values(workflow.jobs) as any[]){
     if(!JSON.stringify(job).includes('secrets.LACEY_PG_DATABASE_URL'))continue;
     expect([job.needs].flat()).toContain('live-release');
     const checkout=job.steps.find((s:any)=>s.uses?.startsWith('actions/checkout@'));
     expect(checkout.with.ref).toBe('${{ needs.live-release.outputs.revision }}');
   }
 }
});
