import type { Env, Watch } from './types';
import { claim, digest, randomToken } from './identity';
import { confirmationEmail } from './email-template';
export const emailReady = (env: Env) =>
  !!(env.RESEND_API_KEY && env.EMAIL_FROM && env.APP_URL);
export async function reserveDelivery(env: Env) {
  const limit = Math.min(
    100000,
    Math.max(1, Number(env.DAILY_EMAIL_LIMIT ?? 100) || 100),
  );
  const day = new Date().toISOString().slice(0, 10);
  return !!(await env.DB.prepare(
    'INSERT INTO delivery_budget(day,reserved) VALUES(?,1) ON CONFLICT(day) DO UPDATE SET reserved=reserved+1 WHERE reserved<? RETURNING reserved',
  )
    .bind(day, limit)
    .first());
}
type Identity = {
  verified_at: string | null;
  token: string | null;
  token_hash: string | null;
  expires_at: string | null;
  sent_at: string | null;
  last_attempt_at: string | null;
  delivery_key: string | null;
  delivery_state: string;
  lease_until: string | null;
};
export async function sendConfirmation(
  env: Env,
  watch: Pick<Watch, 'id' | 'email'> & { owner_id?: string },
  resend = false,
) {
  if (!emailReady(env)) return 'unavailable';
  const owner =
    watch.owner_id ??
    (
      await env.DB.prepare('SELECT owner_id FROM watches WHERE id=?')
        .bind(watch.id)
        .first<{ owner_id: string }>()
    )?.owner_id;
  if (!owner) throw new Error('Confirmation owner missing');
  const now = new Date().toISOString();
  await env.DB.prepare(
    'INSERT INTO email_identities(owner_id,email) VALUES(?,?) ON CONFLICT DO NOTHING',
  )
    .bind(owner, watch.email)
    .run();
  const identity = await env.DB.prepare(
    'SELECT * FROM email_identities WHERE owner_id=? AND email=?',
  )
    .bind(owner, watch.email)
    .first<Identity>();
  if (identity?.verified_at) return 'confirmed';
  if (!resend && identity?.sent_at && identity.expires_at! > now)
    return 'pending';
  // Brief, recoverable throttling; no permanent/day-long signup lock.
  if (identity?.lease_until && identity.lease_until > now) return 'sending';
  if (
    identity?.last_attempt_at &&
    Date.parse(identity.last_attempt_at) > Date.now() - 60000
  )
    return identity.sent_at ? 'pending' : 'retry';
  const token =
      identity?.token && identity.expires_at! > now
        ? identity.token
        : randomToken(),
    hash = await digest(token),
    deliveryKey =
      token !== identity?.token ||
      (resend && identity?.delivery_state === 'sent')
        ? randomToken()
        : (identity?.delivery_key ?? randomToken()),
    lease = new Date(Date.now() + 30000).toISOString();
  await env.DB.prepare(
    `UPDATE email_identities SET token=?,token_hash=?,expires_at=?,lease_until=?,delivery_key=?
  WHERE owner_id=? AND email=? AND verified_at IS NULL AND (lease_until IS NULL OR lease_until<?)`,
  )
    .bind(
      token,
      hash,
      new Date(Date.now() + 86400000).toISOString(),
      lease,
      deliveryKey,
      owner,
      watch.email,
      now,
    )
    .run();
  const locked = await env.DB.prepare(
    'SELECT token_hash,lease_until FROM email_identities WHERE owner_id=? AND email=?',
  )
    .bind(owner, watch.email)
    .first<{ token_hash: string; lease_until: string }>();
  if (locked?.token_hash !== hash || locked.lease_until !== lease)
    return 'sending';
  const addressHash = await digest(watch.email),
    hour = now.slice(0, 13);
  let allowed = false;
  for (let n = 0; n < 5; n++) {
    if (await claim(env, `email-confirm:${addressHash}:${hour}:${n}`)) {
      allowed = true;
      break;
    }
  }
  if (!allowed) {
    await env.DB.prepare(
      'UPDATE email_identities SET lease_until=NULL,delivery_state=?,error_code=? WHERE owner_id=? AND email=?',
    )
      .bind('failed', 'rate_limited', owner, watch.email)
      .run();
    return 'limited';
  }
  await env.DB.prepare(
    "UPDATE email_identities SET last_attempt_at=?,delivery_state='sending',error_code=NULL WHERE owner_id=? AND email=?",
  )
    .bind(now, owner, watch.email)
    .run();
  try {
    const response = await fetch('https://api.resend.com/emails', {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.RESEND_API_KEY}`,
        'Content-Type': 'application/json',
        'Idempotency-Key': `confirm:${deliveryKey}`,
      },
      body: JSON.stringify({
        from: env.EMAIL_FROM,
        to: [watch.email],
        subject: 'One little click for happy feet 😊 — Lacey',
        ...confirmationEmail(
          `${env.APP_URL}/confirm-email?token=${token}`,
          env.APP_URL!,
        ),
      }),
      signal: AbortSignal.timeout(15000),
    });
    if (!response.ok) {
      let code = `http_${response.status}`;
      try {
        const data = (await response.json()) as { name?: string };
        if (data.name && /^[a-z_]+$/i.test(data.name)) code += `:${data.name}`;
      } catch {}
      throw new Error(code);
    }
    await response.body?.cancel();
    await env.DB.prepare(
      "UPDATE email_identities SET sent_at=?,delivery_state='sent',lease_until=NULL,error_code=NULL WHERE owner_id=? AND email=? AND token_hash=?",
    )
      .bind(now, owner, watch.email, hash)
      .run();
    return 'sent';
  } catch (error) {
    // Preserve the same token/message/idempotency key after an uncertain send.
    const code = String((error as Error).message).startsWith('http_')
      ? (error as Error).message
      : 'network_error';
    await env.DB.prepare(
      "UPDATE email_identities SET delivery_state='failed',lease_until=NULL,error_code=? WHERE owner_id=? AND email=? AND token_hash=?",
    )
      .bind(code, owner, watch.email, hash)
      .run();
    console.error('Confirmation email was not accepted', { code });
    return 'failed';
  }
}
