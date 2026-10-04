import { hash, verify } from '@node-rs/argon2';
import { createHash, randomBytes, randomInt } from 'node:crypto';
import { audit, db, now } from './db';

export type Role = 'admin' | 'member';
export interface SessionUser { id: number; username: string; displayName: string; role: Role; mustChange: boolean; sessionId: string; expiresAt: number }

export const COOKIE = 'lb_session';
const DAY = 86_400_000;
const TTL = 30 * DAY;
const sha = (s: string) => createHash('sha256').update(s).digest('hex');

export const hashPassword = (pw: string) => hash(pw);
export const verifyPassword = (h: string, pw: string) => verify(h, pw).catch(() => false);

// Readable temporary password: 3 groups, no ambiguous characters.
export function tempPassword() {
  const a = 'abcdefghjkmnpqrstuvwxyz23456789';
  const part = () => Array.from({ length: 4 }, () => a[randomInt(a.length)]).join('');
  return `${part()}-${part()}-${part()}`;
}

export function validatePassword(pw: string) {
  if (pw.length < 10) return 'Use at least 10 characters.';
  if (pw.length > 200) return 'That password is too long.';
  if (!/[a-zA-Z]/.test(pw) || !/[0-9\W_]/.test(pw)) return 'Mix letters with numbers or symbols.';
  return null;
}

export const validUsername = (u: string) => /^[a-z0-9][a-z0-9._-]{2,31}$/i.test(u);

export function createSession(userId: number, userAgent = '') {
  const token = randomBytes(32).toString('base64url');
  db.prepare('INSERT INTO sessions (id, user_id, created_at, expires_at, user_agent) VALUES (?, ?, ?, ?, ?)')
    .run(sha(token), userId, now(), now() + TTL, userAgent.slice(0, 200));
  return { token, expiresAt: now() + TTL };
}

export function readSession(token: string | undefined): SessionUser | null {
  if (!token) return null;
  const row = db.prepare(`SELECT s.id sid, s.expires_at, u.id, u.username, u.display_name, u.role, u.must_change, u.disabled
                          FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.id = ?`).get(sha(token)) as any;
  if (!row || row.disabled || row.expires_at < now()) return null;
  let expiresAt = row.expires_at;
  if (expiresAt - now() < TTL / 2) { // sliding renewal
    expiresAt = now() + TTL;
    db.prepare('UPDATE sessions SET expires_at = ? WHERE id = ?').run(expiresAt, row.sid);
  }
  return { id: row.id, username: row.username, displayName: row.display_name, role: row.role, mustChange: !!row.must_change, sessionId: row.sid, expiresAt };
}

export const endSession = (sessionId: string) => db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);

// ponytail: in-memory login throttle, per process; move to SQLite if the app ever runs several replicas.
const fails = new Map<string, { n: number; until: number }>();
export function throttled(key: string) {
  const f = fails.get(key);
  return !!f && f.n >= 8 && f.until > now();
}
function noteFail(key: string) {
  const f = fails.get(key);
  const n = f && f.until > now() ? f.n + 1 : 1;
  fails.set(key, { n, until: now() + 15 * 60_000 });
}

export async function login(username: string, password: string, ip: string, ua: string) {
  const key = `${ip}|${username.toLowerCase()}`;
  if (throttled(key)) return { error: 'Too many attempts. Wait 15 minutes and try again.' } as const;
  const u = db.prepare('SELECT id, password_hash, disabled FROM users WHERE username = ?').get(username) as any;
  const ok = u ? await verifyPassword(u.password_hash, password) : await verifyPassword(DUMMY, password);
  if (!u || !ok || u.disabled) { noteFail(key); return { error: u?.disabled && ok ? 'This account is disabled. Ask your admin.' : 'Wrong username or password.' } as const; }
  fails.delete(key);
  audit(u.id, 'login');
  return { session: createSession(u.id, ua) } as const;
}
const DUMMY = await hash('timing-equaliser');

export async function changePassword(userId: number, current: string, next: string, keepSession: string) {
  const u = db.prepare('SELECT password_hash FROM users WHERE id = ?').get(userId) as any;
  if (!u || !(await verifyPassword(u.password_hash, current))) return 'Your current password is wrong.';
  const bad = validatePassword(next);
  if (bad) return bad;
  if (current === next) return 'Choose a password different from the current one.';
  db.prepare('UPDATE users SET password_hash = ?, must_change = 0 WHERE id = ?').run(await hashPassword(next), userId);
  db.prepare('DELETE FROM sessions WHERE user_id = ? AND id != ?').run(userId, keepSession);
  audit(userId, 'password.change');
  return null;
}

export async function createUser(actorId: number | null, username: string, displayName: string, role: Role, password = tempPassword()) {
  db.prepare('INSERT INTO users (username, display_name, password_hash, role, must_change, created_at) VALUES (?, ?, ?, ?, 1, ?)')
    .run(username, displayName, await hashPassword(password), role, now());
  audit(actorId, 'user.create', username);
  return password;
}

export async function resetPassword(actorId: number, userId: number) {
  const pw = tempPassword();
  db.prepare('UPDATE users SET password_hash = ?, must_change = 1 WHERE id = ?').run(await hashPassword(pw), userId);
  db.prepare('DELETE FROM sessions WHERE user_id = ?').run(userId);
  audit(actorId, 'user.reset', String(userId));
  return pw;
}

// First boot: create the admin from env, once.
export async function bootstrapAdmin() {
  const n = (db.prepare('SELECT COUNT(*) n FROM users').get() as any).n;
  const u = process.env.ADMIN_USERNAME, p = process.env.ADMIN_INITIAL_PASSWORD;
  if (n === 0 && u && p) await createUser(null, u, process.env.ADMIN_DISPLAY_NAME || u, 'admin', p);
}
