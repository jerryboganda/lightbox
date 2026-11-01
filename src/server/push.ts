import crypto from 'node:crypto';
import { db, now } from './db';
import { dayStart } from './analytics';
import { mistakeCounts } from './mistakes';
import { getProfile } from './profile';
import { errorText, log } from './log';

// Web Push without a library. Every push is empty, so nothing needs encrypting (RFC 8291); it carries only a VAPID
// ES256 token (RFC 8292). The service worker wakes up, asks /api/push/summary what to say, and shows that.
// Off unless VAPID_PUBLIC_KEY, VAPID_PRIVATE_KEY and VAPID_SUBJECT are set (`npm run vapid` makes a key pair).
const HOSTS = [/^fcm\.googleapis\.com$/, /^updates\.push\.services\.mozilla\.com$/, /^[\w-]+\.notify\.windows\.com$/, /^web\.push\.apple\.com$/];
const TZ_MS = 5 * 3_600_000, DAY = 86_400_000;
export const PUSH = { perUser: 5, maxFails: 5, every: 15 * 60_000, window: 180 };

const keys = new Map<string, crypto.KeyObject>();
export function vapid() {
  const pub = process.env.VAPID_PUBLIC_KEY?.trim(), priv = process.env.VAPID_PRIVATE_KEY?.trim(), subject = process.env.VAPID_SUBJECT?.trim();
  if (!pub || !priv || !subject) return null;
  let key = keys.get(pub + priv);
  if (!key) {
    try {
      const raw = Buffer.from(pub, 'base64url');
      if (raw.length !== 65 || raw[0] !== 4) throw new Error('VAPID_PUBLIC_KEY must be an uncompressed P-256 public key');
      key = crypto.createPrivateKey({ key: { kty: 'EC', crv: 'P-256', d: priv, x: raw.subarray(1, 33).toString('base64url'), y: raw.subarray(33).toString('base64url') }, format: 'jwk' });
      keys.set(pub + priv, key);
    } catch (e) {
      log('error', 'push', { message: `Bad VAPID keys: ${errorText(e)}` });
      return null;
    }
  }
  return { pub, subject, key };
}

const b64 = (o: object) => Buffer.from(JSON.stringify(o)).toString('base64url');
/** The Authorization header for one push service: a 12-hour JWT for its origin plus our public key. */
export function vapidAuth(endpoint: string, v: NonNullable<ReturnType<typeof vapid>>, t = now()) {
  const data = `${b64({ typ: 'JWT', alg: 'ES256' })}.${b64({ aud: new URL(endpoint).origin, exp: Math.floor(t / 1000) + 12 * 3600, sub: v.subject })}`;
  return `vapid t=${data}.${crypto.sign('sha256', Buffer.from(data), { key: v.key, dsaEncoding: 'ieee-p1363' }).toString('base64url')}, k=${v.pub}`;
}

/** Only real browser push services, over https on the default port: the server POSTs to these URLs. */
export function validEndpoint(s: unknown): s is string {
  if (typeof s !== 'string' || s.length > 1000) return false;
  try { const u = new URL(s); return u.protocol === 'https:' && !u.port && !u.username && HOSTS.some((h) => h.test(u.hostname)); } catch { return false; }
}

export function subscribe(uid: number, body: unknown): string | null {
  const b = (body && typeof body === 'object' ? body : {}) as { endpoint?: unknown; keys?: { p256dh?: unknown; auth?: unknown } };
  const k = b.keys;
  if (!validEndpoint(b.endpoint) || typeof k?.p256dh !== 'string' || typeof k.auth !== 'string' || !k.p256dh || !k.auth || k.p256dh.length > 200 || k.auth.length > 100) return 'That browser subscription is not valid.';
  db.transaction(() => {
    db.prepare(`INSERT INTO push_subs (endpoint, user_id, p256dh, auth, created_at) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (endpoint) DO UPDATE SET user_id = excluded.user_id, p256dh = excluded.p256dh, auth = excluded.auth, fails = 0`)
      .run(b.endpoint, uid, k.p256dh, k.auth, now());
    db.prepare('DELETE FROM push_subs WHERE user_id = ? AND endpoint NOT IN (SELECT endpoint FROM push_subs WHERE user_id = ? ORDER BY created_at DESC LIMIT ?)').run(uid, uid, PUSH.perUser);
  })();
  return null;
}

export const unsubscribe = (uid: number, endpoint: unknown) =>
  typeof endpoint === 'string' && db.prepare('DELETE FROM push_subs WHERE user_id = ? AND endpoint = ?').run(uid, endpoint).changes > 0;

export const pushCount = (uid: number) => (db.prepare('SELECT COUNT(*) n FROM push_subs WHERE user_id = ?').get(uid) as { n: number }).n;

const failed = (endpoint: string, why: string, uid: number) => {
  db.prepare('UPDATE push_subs SET fails = fails + 1 WHERE endpoint = ?').run(endpoint);
  db.prepare('DELETE FROM push_subs WHERE endpoint = ? AND fails >= ?').run(endpoint, PUSH.maxFails);
  log('warn', 'push', { message: `${new URL(endpoint).hostname}: ${why}`.slice(0, 300), userId: uid });
};

/** Wakes every device the member subscribed. `daily` marks today's reminder as sent (a test does not). Returns how many accepted it. */
export async function pushTo(uid: number, daily = false) {
  const v = vapid();
  if (!v) return 0;
  const subs = db.prepare('SELECT endpoint FROM push_subs WHERE user_id = ?').all(uid) as { endpoint: string }[];
  let sent = 0;
  for (const { endpoint } of subs) {
    try {
      const res = await fetch(endpoint, { method: 'POST', headers: { TTL: String(12 * 3600), Urgency: 'normal', Authorization: vapidAuth(endpoint, v) }, signal: AbortSignal.timeout(10_000) });
      if (res.ok) {
        sent++;
        db.prepare(`UPDATE push_subs SET fails = 0${daily ? ', last_sent_at = ?' : ''} WHERE endpoint = ?`).run(...(daily ? [now(), endpoint] : [endpoint]));
      } else if (res.status === 404 || res.status === 410) db.prepare('DELETE FROM push_subs WHERE endpoint = ?').run(endpoint);
      else failed(endpoint, `HTTP ${res.status}`, uid);
    } catch (e) { failed(endpoint, errorText(e), uid); }
  }
  return sent;
}

/** What the notification says: due cards and mistakes, or a nudge to start. */
export function summary(uid: number, t = now()) {
  const due = (db.prepare('SELECT COUNT(*) n FROM srs_cards WHERE user_id = ? AND due <= ?').get(uid, t) as { n: number }).n;
  const mistakes = mistakeCounts(uid, t).due;
  const t0 = dayStart(t);
  const today = (db.prepare('SELECT (SELECT COUNT(*) FROM srs_log WHERE user_id = ? AND reviewed_at >= ?) + (SELECT COUNT(*) FROM mcq_attempts WHERE user_id = ? AND created_at >= ?) n').get(uid, t0, uid, t0) as { n: number }).n;
  const s = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;
  const parts = [due && s(due, 'card'), mistakes && s(mistakes, 'mistake')].filter(Boolean) as string[];
  const minutes = Math.max(5, Math.round(due * 0.15 + mistakes));
  return {
    due, mistakes, today,
    title: parts.length ? `${parts.join(' and ')} ready for review` : today ? 'Keep today going' : 'Time to study',
    body: parts.length ? `About ${minutes} minutes clears ${parts.length > 1 || due + mistakes > 1 ? 'them' : 'it'}.` : 'Learn a few new cards to stay on pace.',
    url: due ? '/practice/cards' : mistakes ? '/practice/mcq?set=mistakes' : '/',
  };
}

/** Minutes after midnight, Pakistan time. */
export const pktMinute = (t = now()) => Math.floor(((t + TZ_MS) % DAY) / 60_000);

/** Sends today's reminder to members whose reminder time has passed (within a 3-hour window) and who have something to do. */
export async function remind(t = now()) {
  if (!vapid()) return 0;
  const minute = pktMinute(t), t0 = dayStart(t);
  const users = db.prepare(`SELECT s.user_id id, MAX(COALESCE(s.last_sent_at, 0)) last FROM push_subs s JOIN users u ON u.id = s.user_id
                            WHERE u.disabled = 0 GROUP BY s.user_id`).all() as { id: number; last: number }[];
  let n = 0;
  for (const u of users) {
    if (u.last >= t0) continue;
    const at = getProfile(u.id).prefs.remindAt;
    if (typeof at !== 'number' || minute < at || minute > at + PUSH.window) continue;
    const s = summary(u.id, t);
    if (s.due + s.mistakes === 0 && s.today > 0) continue;
    if (await pushTo(u.id, true)) n++;
  }
  return n;
}

/** Starts the reminder clock once per process (not in tests, not without keys). */
export function startReminders() {
  const g = globalThis as { __lbReminders?: ReturnType<typeof setInterval> };
  if (g.__lbReminders || process.env.VITEST || !vapid()) return;
  g.__lbReminders = setInterval(() => { remind().catch((e) => log('error', 'push', { message: errorText(e) })); }, PUSH.every);
  g.__lbReminders.unref?.();
}
