import { test, expect } from 'bun:test';
import { Database } from 'bun:sqlite';
import { handle } from '../src/server';
import { digest } from '../src/identity';
import type { Env, Statement } from '../src/types';
async function database() {
  const db = new Database(':memory:');
  db.exec('PRAGMA foreign_keys=ON');
  const journal = await Bun.file('drizzle/meta/_journal.json').json();
  for (const { tag } of journal.entries)
    db.exec(await Bun.file(`drizzle/${tag}.sql`).text());
  function q(sql: string, args: unknown[] = []): Statement {
    return {
      bind: (...v) => q(sql, v),
      first: async <T>() =>
        (db.query(sql).get(...(args as any[])) ?? null) as T | null,
      all: async <T>() => ({
        results: db.query(sql).all(...(args as any[])) as T[],
      }),
      run: async () => db.query(sql).run(...(args as any[])),
    };
  }
  return {
    db,
    env: {
      DB: {
        prepare: (sql: string) => q(sql),
        batch: async (statements: Statement[]) => {
          db.exec('BEGIN');
          try {
            for (const s of statements) await s.run();
            db.exec('COMMIT');
          } catch (e) {
            db.exec('ROLLBACK');
            throw e;
          }
        },
      },
      RESEND_API_KEY: 'test',
      EMAIL_FROM: 'Lacey <lacey@example.test>',
      APP_URL: 'https://shoe.test',
      DAILY_EMAIL_LIMIT: '1',
    } as Env,
  };
}
const input = {
  kind: 'category',
  category: 'any',
  fit: 'men',
  size: '9',
  budget: 12000,
  min_discount: 25,
  consent: true,
  email: 'runner@example.test',
};
function request(path: string, owner: string, method = 'GET', body?: unknown) {
  return new Request(`https://shoe.test${path}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Cookie: `brave_device=${Buffer.from(owner).toString('hex').padEnd(64, '0')}`,
    },
    body: body ? JSON.stringify(body) : undefined,
  });
}
async function post(env: Env, owner = 'alice') {
  return (
    await handle(request('/api/watches', owner, 'POST', input), env, '')
  ).json();
}
test('one automatic verification activates all alerts; proof survives deletion and is private to the verified browser', async () => {
  const { db, env } = await database(),
    original = fetch,
    messages: { html: string; text: string }[] = [];
  globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
    messages.push(JSON.parse(String(init?.body)));
    return Response.json({ id: 'accepted' });
  }) as typeof fetch;
  try {
    // An old daily claim or a full sales-email budget cannot block onboarding.
    db.query('INSERT INTO app_state VALUES(?,?)').run(
      `confirm:${await digest(input.email)}:${new Date().toISOString().slice(0, 10)}`,
      'old',
    );
    db.query('INSERT INTO delivery_budget VALUES(?,1)').run(
      new Date().toISOString().slice(0, 10),
    );
    const first = await post(env),
      second = await post(env);
    expect(first.confirmation).toBe('sent');
    expect(second.confirmation).toBe('pending');
    expect(messages).toHaveLength(1);
    await handle(
      request(`/api/watches/${second.id}`, 'alice', 'PATCH', { active: false }),
      env,
      '',
    );
    const bob = await post(env, 'bob');
    expect(bob.confirmation).toBe('sent');
    expect(messages).toHaveLength(2);
    const dashboard = await (
      await handle(request('/api/dashboard', 'alice'), env, '')
    ).json();
    expect(dashboard.verifications).toHaveLength(1);
    expect(JSON.stringify(dashboard)).not.toContain(input.email);
    const token = messages[0].text.match(
      /confirm-email\?token=([a-f0-9]{64})/,
    )![1];
    expect(
      (
        await handle(
          request(`/confirm-email?token=${token}`, 'mail-browser'),
          env,
          '',
        )
      ).headers.get('Set-Cookie'),
    ).toContain('HttpOnly');
    expect(
      db.query('SELECT count(*) n FROM watches WHERE email_verified=1').get(),
    ).toEqual({ n: 0 });
    await handle(
      request(`/confirm-email?token=${token}`, 'mail-browser', 'POST'),
      env,
      '',
    );
    expect(
      db
        .query('SELECT email_verified,active FROM watches WHERE id=?')
        .get(second.id),
    ).toEqual({ email_verified: 1, active: 0 });
    expect(
      db.query('SELECT email_verified FROM watches WHERE id=?').get(bob.id),
    ).toEqual({ email_verified: 0 });
    expect((await post(env)).confirmation).toBe('confirmed');
    expect((await post(env, 'mail-browser')).confirmation).toBe('confirmed');
    expect(messages).toHaveLength(2);
    const owner = (
      db.query('SELECT owner_id FROM watches WHERE id=?').get(first.id) as {
        owner_id: string;
      }
    ).owner_id;
    db.query('DELETE FROM watches WHERE owner_id=?').run(owner);
    expect((await post(env)).confirmation).toBe('confirmed');
    expect(messages).toHaveLength(2);
  } finally {
    globalThis.fetch = original;
    db.close();
  }
});
test('failed sends remain recoverable and retry the same token/message; an explicit resend after success sends again', async () => {
  const { db, env } = await database(),
    original = fetch,
    messages: { key: string; body: string }[] = [];
  let fail = true;
  globalThis.fetch = (async (_u: unknown, init?: RequestInit) => {
    messages.push({
      key: new Headers(init?.headers).get('Idempotency-Key')!,
      body: String(init?.body),
    });
    return fail
      ? Response.json({ name: 'internal_server_error' }, { status: 503 })
      : Response.json({ id: 'accepted' });
  }) as typeof fetch;
  try {
    const first = await post(env);
    expect(first.confirmation).toBe('failed');
    expect(
      db.query('SELECT sent_at,delivery_state FROM email_identities').get(),
    ).toEqual({ sent_at: null, delivery_state: 'failed' });
    const resend = () =>
      handle(
        request(`/api/watches/${first.id}/confirm`, 'alice', 'POST', {}),
        env,
        '',
      ).then((r) => r.json());
    expect((await resend()).confirmation).toBe('retry');
    expect(messages).toHaveLength(1);
    fail = false;
    db.query(
      "UPDATE email_identities SET last_attempt_at='2020-01-01T00:00:00.000Z'",
    ).run();
    expect((await resend()).confirmation).toBe('sent');
    expect(messages[1]).toEqual(messages[0]);
    db.query(
      "UPDATE email_identities SET last_attempt_at='2020-01-01T00:00:00.000Z'",
    ).run();
    expect((await resend()).confirmation).toBe('sent');
    expect(messages[2].key).not.toBe(messages[1].key);
    expect(messages[2].body).toBe(messages[1].body);
  } finally {
    globalThis.fetch = original;
    db.close();
  }
});
