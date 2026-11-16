import { strict as assert } from "node:assert";
import { mkdtemp, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
const deployment = process.argv[2],
  secret = process.env.CRON_SECRET;
assert.ok(
  deployment?.startsWith("https://lacey-") &&
    new URL(deployment).hostname.endsWith(".vercel.app"),
  "Probe only an exact staged Lacey deployment",
);
assert.ok(
  secret,
  "Configure CRON_SECRET in the private .env.operations.local before releasing",
);
const directory = await mkdtemp(join(tmpdir(), "lacey-ready-"));
try {
  const header = join(directory, "headers");
  await writeFile(
    header,
    `Authorization: Bearer ${secret}\nContent-Type: application/json\n`,
    { mode: 0o600 },
  );
  const nonce = crypto.randomUUID().replaceAll("-", "");
  const child = Bun.spawn(
    [
      "bunx",
      "--bun",
      "vercel@65.16.0",
      "curl",
      "/api/internal/ready",
      "--deployment",
      deployment,
      "--",
      "--silent",
      "--show-error",
      "--fail",
      "--max-time",
      "10",
      "--request",
      "POST",
      "--header",
      `@${header}`,
      "--data",
      JSON.stringify({ nonce }),
      "--write-out",
      "\n%{http_code} %{time_total}",
    ],
    { stdout: "pipe", stderr: "pipe" },
  );
  const [code, raw] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  assert.equal(code, 0, "Database write probe failed; nothing promoted");
  const split = raw.lastIndexOf("\n"),
    [status, seconds] = raw
      .slice(split + 1)
      .trim()
      .split(" ");
  assert.equal(status, "200");
  assert.equal(
    JSON.parse(raw.slice(0, split)).ready,
    true,
    "Database did not confirm its operational write",
  );
  assert.ok(
    Number(seconds) <= 5,
    "Database writes exceed the five-second readiness budget",
  );
  console.log(
    "Staged database write probe passed; no member records or emails touched.",
  );
} finally {
  await rm(directory, { recursive: true, force: true });
}
