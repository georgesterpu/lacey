import { strict as assert } from "node:assert";
import { protectedSite, verifySite } from "./browser-smoke";

const scope = "george-sterpus-projects",
  site = "https://lacey.january.ie";
async function command(args: string[], capture = false) {
  const child = Bun.spawn(args, {
    stdout: capture ? "pipe" : "inherit",
    stderr: "inherit",
  });
  const output = capture
    ? await new Response(child.stdout as ReadableStream).text()
    : "";
  if ((await child.exited) !== 0)
    throw new Error(`Release stopped: ${args.slice(0, 4).join(" ")}`);
  return output.trim();
}
const cli = (...args: string[]) =>
  command(["bunx", "--bun", "vercel@65.16.0", ...args, "--scope", scope], true);
const json = (text: string) => JSON.parse(text.slice(text.indexOf("{")));
assert.equal(
  await command(["git", "status", "--porcelain"], true),
  "",
  "Commit changes before releasing",
);
assert.equal(
  await command(["git", "branch", "--show-current"], true),
  "main",
  "Release from main",
);
const config = await Bun.file(".vercel/project.json").json();
assert.equal(
  config.projectId,
  "prj_dMJPR26hdpOfYyHecvwO6aMNeiNi",
  "Wrong linked project",
);
assert.equal(
  config.orgId,
  "team_r2QjamnMXJytuHyHNJwIIxoj",
  "Wrong Vercel team",
);
await cli("project", "inspect", "--non-interactive");
const revision = await command(["git", "rev-parse", "HEAD"], true);
for (const script of ["check", "test", "build:vercel"])
  await command([process.execPath, "run", script]);

// This also requires the independent browser guard on the same Git revision.
let passed = false;
for (let attempt = 0; attempt < 18; attempt++) {
  const runs = JSON.parse(
    await command(
      [
        "gh",
        "run",
        "list",
        "--repo",
        "georgesterpu/shoehoo-jobs",
        "--workflow",
        "quality.yml",
        "--commit",
        revision,
        "--limit",
        "1",
        "--json",
        "status,conclusion",
      ],
      true,
    ),
  );
  if (runs[0]?.status === "completed") {
    assert.equal(
      runs[0].conclusion,
      "success",
      "GitHub quality/browser checks failed",
    );
    passed = true;
    break;
  }
  console.log("Waiting for GitHub quality/browser checks on this revision…");
  await Bun.sleep(10000);
}
assert.ok(passed, "GitHub checks did not pass; nothing promoted");
const previous = json(await cli("inspect", site, "--json"));
assert.ok(
  previous.url?.endsWith(".vercel.app"),
  "Cannot identify rollback deployment",
);
console.log("Staging production build without changing the live domain…");
const staged = json(
  await cli("deploy", "--prod", "--skip-domain", "--yes"),
).deployment;
assert.ok(
  staged?.url?.startsWith("https://lacey-") &&
    new URL(staged.url).hostname.endsWith(".vercel.app"),
  "Unexpected staged deployment",
);
await command([
  process.execPath,
  "--env-file=.env.operations.local",
  "scripts/write-smoke.ts",
  staged.url,
]);
const proxy = await protectedSite(staged.url);
try {
  await verifySite(proxy.url.origin);
} finally {
  proxy.stop(true);
}
console.log(
  "Staged database, API and browser checks passed. Promoting this exact deployment…",
);
await cli("promote", staged.url, "--yes");
try {
  await verifySite(site);
  console.log(
    `Released ${revision.slice(0, 7)} to ${site}; public browser checks passed.`,
  );
} catch (error) {
  console.error(
    "Public smoke failed after promotion; restoring the previous deployment.",
  );
  await cli("rollback", `https://${previous.url}`, "--yes");
  throw error;
}
