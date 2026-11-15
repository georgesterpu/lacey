// Isolated browser QA: in-memory database and a fake mail provider. No real mail.
import { Database } from 'bun:sqlite';
import { strict as assert } from 'node:assert';
import { handle } from '../src/server';
import type { Env, Statement } from '../src/types';
const db = new Database(':memory:');
db.exec('PRAGMA foreign_keys=ON');
const journal = await Bun.file('drizzle/meta/_journal.json').json();
for (const { tag } of journal.entries)
  db.exec(await Bun.file(`drizzle/${tag}.sql`).text());
function query(sql: string, args: unknown[] = []): Statement {
  return {
    bind: (...v) => query(sql, v),
    first: async <T>() =>
      (db.query(sql).get(...(args as any[])) ?? null) as T | null,
    all: async <T>() => ({
      results: db.query(sql).all(...(args as any[])) as T[],
    }),
    run: async () => db.query(sql).run(...(args as any[])),
  };
}
const env: Env = {
  DB: {
    prepare: (sql) => query(sql),
    batch: async (statements) => {
      db.exec('BEGIN');
      try {
        for (const q of statements) await q.run();
        db.exec('COMMIT');
      } catch (e) {
        db.exec('ROLLBACK');
        throw e;
      }
    },
  },
  RESEND_API_KEY: 'fake',
  EMAIL_FROM: 'Lacey <lacey@example.test>',
};
const build = await Bun.build({
  entrypoints: ['src/client.ts'],
  target: 'browser',
});
if (!build.success) throw new Error('Client build failed');
const code = await build.outputs[0].text();
const messages: { text: string }[] = [],
  original = globalThis.fetch;
globalThis.fetch = (async (url: unknown, init?: RequestInit) => {
  if (String(url) !== 'https://api.resend.com/emails')
    throw new Error('Unexpected external request');
  const message = JSON.parse(String(init?.body));
  assert.ok(
    message.to.every((address: string) => address.endsWith('@example.test')),
  );
  messages.push(message);
  return Response.json({ id: 'fake-message' });
}) as typeof fetch;
const server = Bun.serve({
  hostname: '127.0.0.1',
  port: 0,
  fetch: (r) => handle(r, env, code),
});
env.APP_URL = server.url.origin;
try {
  await using view = new Bun.WebView({
    width: 390,
    height: 844,
    backend: { type: 'chrome', path: process.env.BUN_CHROME_PATH, url: false },
  });
  const until = async (expression: string) => {
    for (let n = 0; n < 150; n++) {
      if (await view.evaluate(expression)) return;
      await Bun.sleep(100);
    }
    throw new Error(`Browser timeout: ${expression}`);
  };
  await view.navigate(env.APP_URL);
  await until('document.querySelector("#filter-region").options.length>5');
  async function add() {
    await view.click('.header-cta');
    await view.evaluate(
      '(()=>{document.querySelector("#watch-size").value="9";document.querySelector("[name=fit]").value="men"})()',
    );
    await view.click('#watch-next');
    await view.evaluate(
      'document.querySelector("#watch-email").value="browser@example.test"',
    );
    await view.click('[name="consent"]');
    await view.click('#watch-submit');
    await until('!document.querySelector("#watch-dialog").open');
  }
  await add();
  await until(
    'document.querySelector("#email-verifications").textContent.includes("Check your email")',
  );
  assert.equal(messages.length, 1);
  const token = messages[0].text.match(
    /confirm-email\?token=([a-f0-9]{64})/,
  )![1];
  await view.navigate(`${env.APP_URL}/confirm-email?token=${token}`);
  await view.click('form button');
  await until(
    'document.querySelector("h1").textContent.includes("Email confirmed")',
  );
  await view.navigate(env.APP_URL);
  await until('document.querySelectorAll(".watch-card").length===1');
  await add();
  await until('document.querySelectorAll(".watch-card").length===2');
  assert.equal(messages.length, 1);
  assert.equal(
    await view.evaluate('document.querySelectorAll("[data-confirm]").length'),
    0,
  );
  assert.equal(
    await view.evaluate(
      '[...document.querySelectorAll(".watch-state")].every(e=>e.textContent.includes("Active"))',
    ),
    true,
  );
  assert.equal(
    await view.evaluate('document.documentElement.scrollWidth>innerWidth'),
    false,
  );
  console.log(
    'Mobile browser: first submit sent one verification email; confirmation activated alerts; second alert was immediately active with no further email or confirmation; no horizontal overflow.',
  );
} finally {
  server.stop(true);
  globalThis.fetch = original;
  db.close();
}
