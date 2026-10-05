import { audit, db, now } from './db';
import { notify } from './notify';
import { createUser, resetPassword, validUsername, type Role, type SessionUser } from './auth';
import { DAY, dayKey, dayStart } from './analytics';
import { intId, itemInfo, text } from './personal';
import { factById, images, mcqs, shortFile, topicBySlug } from '../lib/data';

// Admin console: overview, accounts, moderation, polls, AI review, audit and exports. Every mutation audits.
type Row = Record<string, any>;
export type Result<T> = T | { error: string; status?: number; [k: string]: unknown };

const one = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { n: number }).n;
const pick = <T extends readonly string[]>(list: T, v: unknown) => (list.includes(v as string) ? (v as T[number]) : null);
const iso = (t: number | null | undefined) => (t ? new Date(t).toISOString() : null);
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const parse = <T>(s: unknown, fallback: T): T => { try { return JSON.parse(String(s)) ?? fallback; } catch { return fallback; } };
const mcqById = new Map(mcqs.map((m) => [m.qid, m]));
const imageByFile = new Map(images.map((i) => [i.file, i]));

export const isAdmin = (u: SessionUser | null | undefined): u is SessionUser => u?.role === 'admin';
export const denied = () => Response.json({ error: 'Admins only.' }, { status: 403 });
export const reply = (r: Row, ok = 200) => Response.json(r, { status: 'error' in r ? r.status ?? 400 : ok, headers: { 'cache-control': 'no-store' } });
/** Internal page paths only: no scheme, no protocol-relative or backslash tricks. */
export const safePath = (p: unknown) => (typeof p === 'string' && p.length <= 300 && /^\/(?:[^/\\\s][^\s\\]*)?$/.test(p) ? p : null);

// ---- overview ----
const DAYSQL = (col: string) => `strftime('%Y-%m-%d', (${col} + 18000000) / 1000, 'unixepoch')`; // Pakistan day
export function overview() {
  const t = now(), t0 = dayStart(t), from = t0 - 13 * DAY;
  const kpi = {
    members: one('SELECT COUNT(*) n FROM users WHERE disabled = 0'),
    awaiting: one('SELECT COUNT(*) n FROM users WHERE disabled = 0 AND must_change = 1'),
    activeToday: one('SELECT COUNT(*) n FROM users WHERE disabled = 0 AND last_seen_at >= ?', t0),
    active7: one('SELECT COUNT(*) n FROM users WHERE disabled = 0 AND last_seen_at >= ?', t0 - 6 * DAY),
    openReports: one("SELECT COUNT(*) n FROM reports WHERE status = 'open'"),
    hiddenComments: one('SELECT COUNT(*) n FROM comments WHERE hidden = 1 AND deleted = 0'),
    comments7: one('SELECT COUNT(*) n FROM comments WHERE created_at >= ?', t0 - 6 * DAY),
    pendingAi: one("SELECT COUNT(*) n FROM ai_mcqs WHERE status = 'pending'"),
    aiToday: one('SELECT COALESCE(SUM(n), 0) n FROM ai_usage WHERE day = ?', dayKey(t)),
    openPolls: one('SELECT COUNT(*) n FROM polls WHERE closed = 0 AND (closes_at IS NULL OR closes_at > ?)', t),
  };
  // ponytail: day counts scan srs_log / mcq_attempts / comments by time; add created-at indexes if a class ever outgrows this.
  const per = (table: string, col: string) => new Map((db.prepare(`SELECT ${DAYSQL(col)} d, COUNT(*) n FROM ${table} WHERE ${col} >= ? GROUP BY d`).all(from) as { d: string; n: number }[]).map((r) => [r.d, r.n]));
  const rv = per('srs_log', 'reviewed_at'), an = per('mcq_attempts', 'created_at'), cm = per('comments', 'created_at');
  const days = Array.from({ length: 14 }, (_, i) => {
    const day = dayKey(from + i * DAY);
    return { day, reviews: rv.get(day) ?? 0, answers: an.get(day) ?? 0, comments: cm.get(day) ?? 0 };
  });
  return { kpi, days };
}

/** Badges on the console tabs: what is waiting in each. */
export const navCounts = () => ({
  users: one('SELECT COUNT(*) n FROM users WHERE disabled = 0'),
  moderation: one("SELECT COUNT(*) n FROM reports WHERE status = 'open'"),
  polls: one('SELECT COUNT(*) n FROM polls WHERE closed = 0 AND (closes_at IS NULL OR closes_at > ?)', now()),
  ai: one("SELECT COUNT(*) n FROM ai_mcqs WHERE status = 'pending'"),
  announcements: one('SELECT COUNT(*) n FROM announcements WHERE active = 1'),
});

// ---- users ----
export interface UserRow { id: number; username: string; name: string; role: Role; disabled: number; mustChange: number; createdAt: number; lastSeen: number | null; reviews: number; answered: number; comments: number; reports: number; aiToday: number }
export function listUsers(ids?: number[]): UserRow[] {
  return db.prepare(`SELECT u.id, u.username, u.display_name name, u.role, u.disabled, u.must_change mustChange, u.created_at createdAt, u.last_seen_at lastSeen,
      COALESCE(r.n, 0) reviews, COALESCE(a.n, 0) answered, COALESCE(c.n, 0) comments, COALESCE(p.n, 0) reports, COALESCE(ai.n, 0) aiToday
    FROM users u
    LEFT JOIN (SELECT user_id, COUNT(*) n FROM srs_log GROUP BY user_id) r ON r.user_id = u.id
    LEFT JOIN (SELECT user_id, COUNT(DISTINCT qid) n FROM mcq_attempts GROUP BY user_id) a ON a.user_id = u.id
    LEFT JOIN (SELECT user_id, COUNT(*) n FROM comments WHERE deleted = 0 GROUP BY user_id) c ON c.user_id = u.id
    LEFT JOIN (SELECT user_id, COUNT(*) n FROM reports GROUP BY user_id) p ON p.user_id = u.id
    LEFT JOIN ai_usage ai ON ai.user_id = u.id AND ai.day = ?
    ${ids ? 'WHERE u.id IN (SELECT value FROM json_each(?))' : ''}
    ORDER BY u.disabled, u.role, u.username`).all(...(ids ? [dayKey(now()), JSON.stringify(ids)] : [dayKey(now())])) as UserRow[];
}

const cleanName = (v: unknown) => (typeof v === 'string' ? v.replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim() : '');
function checkNew(username: unknown, name: unknown): { error: string } | { username: string; name: string } {
  const u = typeof username === 'string' ? username.trim().toLowerCase() : '';
  if (!validUsername(u)) return { error: `${u ? `"${clip(u, 40)}": u` : 'U'}sernames are 3–32 characters: letters, numbers, dot, dash or underscore.` };
  const n = cleanName(name);
  if (n.length > 60) return { error: 'Display names are up to 60 characters.' };
  if (db.prepare('SELECT 1 FROM users WHERE username = ?').get(u)) return { error: `@${u} already exists.` };
  return { username: u, name: n || u };
}
const byName = (u: string) => (db.prepare('SELECT id FROM users WHERE username = ?').get(u) as { id: number }).id;

export async function addUser(actorId: number, b: Row): Promise<Result<{ user: UserRow; password: string }>> {
  const c = checkNew(b.username, b.displayName);
  if ('error' in c) return c;
  const role = b.role === 'admin' ? 'admin' : 'member';
  let password: string;
  try { password = await createUser(actorId, c.username, c.name, role); } catch { return { error: `@${c.username} already exists.` }; } // taken while hashing (double submit)
  if (role === 'admin') audit(actorId, 'user.role', `${c.username}:admin`);
  return { user: listUsers([byName(c.username)])[0], password };
}

export const BULK_MAX = 50;
type BulkLine = { line: number; raw: string; error?: string; username?: string; name?: string };
/** One "username, Display Name" (or tab-separated) per line; blank lines and # comments are skipped. */
export function parseBulk(input: unknown): Result<{ rows: BulkLine[] }> {
  if (typeof input !== 'string' || input.length > 20_000) return { error: 'Paste one "username, Display Name" per line.' };
  const lines = input.split(/\r?\n/).map((raw, i) => ({ line: i + 1, raw: raw.trim() })).filter((l) => l.raw && !l.raw.startsWith('#'));
  if (!lines.length) return { error: 'Paste one "username, Display Name" per line.' };
  if (lines.length > BULK_MAX) return { error: `Up to ${BULK_MAX} accounts at a time.` };
  const seen = new Set<string>();
  return {
    rows: lines.map(({ line, raw }) => {
      const [, u, n] = raw.match(/^([^,\t]*)[,\t]?(.*)$/)!;
      const c = checkNew(u, n);
      if ('error' in c) return { line, raw, error: c.error };
      if (seen.has(c.username)) return { line, raw, error: `@${c.username} appears twice.` };
      seen.add(c.username);
      return { line, raw, ...c };
    }),
  };
}

/** All lines must pass before any account is made, so a fixed paste can simply be resubmitted. */
export async function bulkAdd(actorId: number, input: unknown): Promise<Result<{ created: { username: string; name: string; password: string }[]; users: UserRow[] }>> {
  const p = parseBulk(input);
  if ('error' in p) return p;
  const bad = p.rows.filter((r) => r.error);
  if (bad.length) return { error: `${bad.length} line${bad.length === 1 ? ' needs' : 's need'} fixing. No accounts were created.`, lines: bad.map(({ line, raw, error }) => ({ line, raw, error })) };
  const created: { username: string; name: string; password: string }[] = [];
  for (const r of p.rows) {
    try { created.push({ username: r.username!, name: r.name!, password: await createUser(actorId, r.username!, r.name!, 'member') }); } catch { /* taken in the meantime: left out of the list */ }
  }
  return { created, users: listUsers(created.map((c) => byName(c.username))) };
}

export async function userAction(me: SessionUser, id: number, action: unknown): Promise<Result<{ text: string; user?: UserRow; password?: string; username?: string }>> {
  const t = db.prepare('SELECT id, username, role, disabled FROM users WHERE id = ?').get(id) as Row | undefined;
  if (!t) return { error: 'User not found.', status: 404 };
  if (action === 'reset') {
    // Resetting your own password signs you out with a password shown once: a sole admin who misses it is locked out.
    if (t.id === me.id) return { error: 'Change your own password from your account page.' };
    const password = await resetPassword(me.id, t.id);
    return { text: `New temporary password for @${t.username}. Their sessions were signed out.`, username: t.username, password, user: listUsers([t.id])[0] };
  }
  if (action === 'toggle') {
    if (t.id === me.id) return { error: "You can't disable your own account." };
    db.prepare('UPDATE users SET disabled = ? WHERE id = ?').run(t.disabled ? 0 : 1, t.id);
    if (!t.disabled) db.prepare('DELETE FROM sessions WHERE user_id = ?').run(t.id);
    audit(me.id, t.disabled ? 'user.enable' : 'user.disable', t.username);
    return { text: `@${t.username} ${t.disabled ? 'enabled' : 'disabled'}.`, user: listUsers([t.id])[0] };
  }
  if (action === 'role') {
    const next = t.role === 'admin' ? 'member' : 'admin';
    if (next === 'member' && !t.disabled && one("SELECT COUNT(*) n FROM users WHERE role = 'admin' AND disabled = 0") <= 1) return { error: 'Keep at least one admin.' };
    db.prepare('UPDATE users SET role = ? WHERE id = ?').run(next, t.id);
    audit(me.id, 'user.role', `${t.username}:${next}`);
    return { text: `@${t.username} is now ${next === 'admin' ? 'an admin' : 'a member'}.`, user: listUsers([t.id])[0] };
  }
  return { error: 'Unknown action.' };
}

// ---- announcements ----
export const listAnnouncements = () => ({
  active: db.prepare('SELECT a.id, a.body, a.created_at createdAt, u.username FROM announcements a LEFT JOIN users u ON u.id = a.created_by WHERE a.active = 1 ORDER BY a.created_at DESC').all() as Row[],
  past: db.prepare('SELECT a.id, a.body, a.created_at createdAt, u.username FROM announcements a LEFT JOIN users u ON u.id = a.created_by WHERE a.active = 0 ORDER BY a.created_at DESC LIMIT 6').all() as Row[],
});

export function announce(actorId: number, body: unknown, everyone: unknown): Result<{ id: number }> {
  const b = text(body, 600);
  if (!b) return { error: 'Write the announcement (up to 600 characters).' };
  const id = Number(db.prepare('INSERT INTO announcements (body, created_by, created_at) VALUES (?, ?, ?)').run(b, actorId, now()).lastInsertRowid);
  audit(actorId, 'announcement.create', `#${id}${everyone === true ? ' +notify' : ''}`);
  if (everyone === true) notify('all', { kind: 'announcement', title: 'New announcement', body: b, href: '/' }, actorId);
  return { id };
}

export function hideAnnouncement(actorId: number, id: number): Result<{ ok: true }> {
  if (!db.prepare('UPDATE announcements SET active = 0 WHERE id = ? AND active = 1').run(id).changes) return { error: 'Announcement not found.', status: 404 };
  audit(actorId, 'announcement.hide', `#${id}`);
  return { ok: true };
}

// ---- item context (what a report or comment is about) ----
export interface Ctx { type: string; id: string; title: string; sub: string; href: string | null; label?: string; missing?: boolean; author?: string; state?: string }
type CommentRef = { id: number; item_type: string; item_id: string; body: string; hidden: number; deleted: number; username: string; name: string; user_id: number };
const commentsById = (ids: string[]) => new Map((ids.length ? db.prepare(`SELECT c.id, c.user_id, c.item_type, c.item_id, c.body, c.hidden, c.deleted, u.username, u.display_name name
    FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id IN (SELECT value FROM json_each(?))`).all(JSON.stringify(ids.map(Number).filter(Number.isSafeInteger))) as CommentRef[] : []).map((c) => [String(c.id), c]));

export function context(type: string, id: string, comments?: Map<string, CommentRef>): Ctx {
  if (type === 'comment') {
    const c = comments?.get(id);
    if (!c) return { type, id, title: 'This comment was deleted.', sub: `Comment #${id}`, href: null, missing: true };
    const on = context(c.item_type, c.item_id);
    return { type, id, title: clip(c.body, 600), sub: `On ${clip(on.title, 90)}`, href: on.href, author: `${c.name} (@${c.username})`, state: c.deleted ? 'deleted by author' : c.hidden ? 'hidden' : undefined };
  }
  if (type === 'dispute') {
    const inner = mcqById.has(id) ? itemInfo(0, 'mcq', id) : factById.has(id) ? itemInfo(0, 'fact', id) : null;
    return inner ? { type, id, title: clip(inner.title, 300), sub: `Disputed · ${inner.sub}`, href: mcqById.has(id) ? '/review#mcqs' : '/review', label: inner.label } : { type, id, title: `Disputed item ${id}`, sub: 'Review centre', href: '/review' };
  }
  const i = ['fact', 'topic', 'mcq', 'image'].includes(type) ? itemInfo(0, type, id) : null;
  return i ? { type, id, title: clip(i.title, 600), sub: i.sub, href: i.href, label: i.label } : { type, id, title: `${type} ${id}`, sub: 'Not in the current content', href: null, missing: true };
}

// ---- reports ----
export const REPORT_STATUS = ['open', 'accepted', 'rejected', 'fixed'] as const;
export const REPORT_KINDS = ['wrong', 'source', 'typo', 'unclear', 'duplicate', 'offensive', 'other'] as const;
export const REPORT_TYPES = ['fact', 'topic', 'mcq', 'image', 'comment'] as const;
export interface ReportRow { id: number; userId: number; type: string; itemId: string; kind: string; body: string; quote: string; path: string | null; status: string; resolution: string; resolvedAt: number | null; createdAt: number; username: string; name: string; resolver: string | null; ctx: Ctx }

export function listReports(f: { status?: unknown; kind?: unknown; type?: unknown }, limit = 200): ReportRow[] {
  const where: string[] = [], args: unknown[] = [];
  for (const [col, v] of [['r.status', pick(REPORT_STATUS, f.status)], ['r.kind', pick(REPORT_KINDS, f.kind)], ['r.item_type', pick(REPORT_TYPES, f.type)]] as const) if (v) { where.push(`${col} = ?`); args.push(v); }
  const rows = db.prepare(`SELECT r.id, r.user_id userId, r.item_type type, r.item_id itemId, r.kind, r.body, r.quote, r.path, r.status, r.resolution, r.resolved_at resolvedAt, r.created_at createdAt,
      u.username, u.display_name name, v.username resolver
    FROM reports r JOIN users u ON u.id = r.user_id LEFT JOIN users v ON v.id = r.resolved_by
    ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY r.created_at DESC LIMIT ?`).all(...args, limit) as Omit<ReportRow, 'ctx'>[];
  const cm = commentsById(rows.filter((r) => r.type === 'comment').map((r) => r.itemId));
  return rows.map((r) => ({ ...r, path: safePath(r.path), ctx: context(r.type, r.itemId, cm) }));
}

export const reportCounts = () => {
  const c = Object.fromEntries(REPORT_STATUS.map((s) => [s, 0])) as Record<string, number>;
  for (const r of db.prepare('SELECT status, COUNT(*) n FROM reports GROUP BY status').all() as { status: string; n: number }[]) c[r.status] = r.n;
  return { ...c, all: Object.values(c).reduce((a, b) => a + b, 0) } as Record<(typeof REPORT_STATUS)[number] | 'all', number>;
};

const VERB = { accepted: 'accept', rejected: 'reject', fixed: 'fix' } as const;
export function resolveReport(actorId: number, id: number, status: unknown, resolution: unknown): Result<{ status: string; resolution: string; resolvedAt: number }> {
  if (status !== 'accepted' && status !== 'rejected' && status !== 'fixed') return { error: 'Choose accept, reject or mark fixed.' };
  const note = text(resolution ?? '', 1000, 0);
  if (note === null) return { error: 'Keep the note to 1000 characters.' };
  const r = db.prepare('SELECT id, user_id, item_type, item_id, path, status, resolution FROM reports WHERE id = ?').get(id) as Row | undefined;
  if (!r) return { error: 'Report not found.', status: 404 };
  if (r.status === status) return { error: `This report is already ${status}.` };
  const t = now(), res = note || r.resolution; // an empty note keeps the earlier one (accepted, then fixed)
  db.prepare('UPDATE reports SET status = ?, resolution = ?, resolved_by = ?, resolved_at = ? WHERE id = ?').run(status, res, actorId, t, id);
  audit(actorId, `report.${VERB[status]}`, `#${id} ${r.item_type} ${r.item_id}`);
  const href = safePath(r.path) ?? context(r.item_type, r.item_id, r.item_type === 'comment' ? commentsById([r.item_id]) : undefined).href ?? undefined;
  notify(r.user_id, { kind: 'report', title: `Your report was ${status}`, body: res, href }, actorId);
  return { status, resolution: res, resolvedAt: t };
}

// ---- comments ----
export const COMMENT_FILTERS = ['all', 'visible', 'hidden', 'deleted'] as const;
export interface CommentRow { id: number; userId: number; type: string; itemId: string; parentId: number | null; body: string; createdAt: number; editedAt: number | null; deleted: number; hidden: number; hiddenReason: string; hiddenBy: string | null; username: string; name: string; votes: number; reports: number; ctx: Ctx }
const COMMENT_WHERE = { all: '', visible: 'WHERE c.hidden = 0 AND c.deleted = 0', hidden: 'WHERE c.hidden = 1', deleted: 'WHERE c.deleted = 1' };

export function listComments(filter: unknown, limit = 150): CommentRow[] {
  const f = pick(COMMENT_FILTERS, filter) ?? 'all';
  const rows = db.prepare(`SELECT c.id, c.user_id userId, c.item_type type, c.item_id itemId, c.parent_id parentId, c.body, c.created_at createdAt, c.edited_at editedAt, c.deleted, c.hidden,
      c.hidden_reason hiddenReason, h.username hiddenBy, u.username, u.display_name name,
      (SELECT COUNT(*) FROM votes v WHERE v.item_type = 'comment' AND v.item_id = CAST(c.id AS TEXT)) votes,
      (SELECT COUNT(*) FROM reports r WHERE r.item_type = 'comment' AND r.item_id = CAST(c.id AS TEXT) AND r.status = 'open') reports
    FROM comments c JOIN users u ON u.id = c.user_id LEFT JOIN users h ON h.id = c.hidden_by
    ${COMMENT_WHERE[f]} ORDER BY c.created_at DESC LIMIT ?`).all(limit) as Omit<CommentRow, 'ctx'>[];
  return rows.map((r) => ({ ...r, ctx: context(r.type, r.itemId) }));
}

export const commentCounts = () => db.prepare(`SELECT COUNT(*) "all", COALESCE(SUM(hidden = 0 AND deleted = 0), 0) visible, COALESCE(SUM(hidden), 0) hidden, COALESCE(SUM(deleted), 0) deleted FROM comments`).get() as Record<(typeof COMMENT_FILTERS)[number], number>;

const commentRow = (id: number) => db.prepare('SELECT c.id, c.user_id, c.item_type, c.item_id, c.body, c.hidden, c.deleted, u.username FROM comments c JOIN users u ON u.id = c.user_id WHERE c.id = ?').get(id) as Row | undefined;

export function hideComment(actorId: number, id: number, reason: unknown): Result<{ ok: true }> {
  const why = text(reason, 300);
  if (!why) return { error: 'Give a reason (up to 300 characters). The author sees it.' };
  const c = commentRow(id);
  if (!c) return { error: 'Comment not found.', status: 404 };
  if (c.hidden) return { error: 'That comment is already hidden.' };
  db.prepare('UPDATE comments SET hidden = 1, hidden_by = ?, hidden_reason = ? WHERE id = ?').run(actorId, why, id);
  audit(actorId, 'comment.hide', `#${id} @${c.username}: ${clip(why, 80)}`);
  notify(c.user_id, { kind: 'moderation', title: 'Your comment was hidden', body: `${why}\n\n"${clip(c.body, 160)}"`, href: context(c.item_type, c.item_id).href ?? undefined }, actorId);
  return { ok: true };
}

export function unhideComment(actorId: number, id: number): Result<{ ok: true }> {
  const c = commentRow(id);
  if (!c) return { error: 'Comment not found.', status: 404 };
  if (!c.hidden) return { error: 'That comment is not hidden.' };
  db.prepare("UPDATE comments SET hidden = 0, hidden_by = NULL, hidden_reason = '' WHERE id = ?").run(id);
  audit(actorId, 'comment.unhide', `#${id} @${c.username}`);
  return { ok: true };
}

/** Removes the comment, its replies (cascade) and their upvotes. */
export function deleteComment(actorId: number, id: number): Result<{ ok: true; removed: number }> {
  const c = commentRow(id);
  if (!c) return { error: 'Comment not found.', status: 404 };
  const removed = db.transaction(() => {
    const ids = (db.prepare('WITH RECURSIVE t(id) AS (SELECT ? UNION ALL SELECT c.id FROM comments c JOIN t ON c.parent_id = t.id) SELECT id FROM t').all(id) as { id: number }[]).map((r) => String(r.id));
    db.prepare("DELETE FROM votes WHERE item_type = 'comment' AND item_id IN (SELECT value FROM json_each(?))").run(JSON.stringify(ids));
    db.prepare('DELETE FROM comments WHERE id = ?').run(id);
    return ids.length;
  })();
  audit(actorId, 'comment.delete', `#${id} @${c.username}: ${clip(c.body.replace(/\s+/g, ' '), 80)}`);
  return { ok: true, removed };
}

// ---- polls ----
export interface PollRow { id: number; type: string; itemId: string | null; question: string; options: { key: string; label: string; n: number }[]; voters: number; createdAt: number; closesAt: number | null; closed: boolean; manual: boolean; creator: string | null; mcq: { qid: string; key: string; href: string } | null }
export function listPolls(id?: number): PollRow[] {
  const t = now();
  const rows = db.prepare(`SELECT p.id, p.item_type, p.item_id, p.question, p.options, p.created_at, p.closes_at, p.closed, u.username creator
    FROM polls p LEFT JOIN users u ON u.id = p.created_by ${id ? 'WHERE p.id = ?' : ''} ORDER BY p.created_at DESC LIMIT 200`).all(...(id ? [id] : [])) as Row[];
  const votes = new Map<number, Map<string, number>>();
  for (const v of db.prepare(`SELECT poll_id, choice, COUNT(*) n FROM poll_votes ${id ? 'WHERE poll_id = ?' : ''} GROUP BY poll_id, choice`).all(...(id ? [id] : [])) as { poll_id: number; choice: string; n: number }[])
    (votes.get(v.poll_id) ?? votes.set(v.poll_id, new Map()).get(v.poll_id)!).set(v.choice, v.n);
  return rows.map((p) => {
    const tally = votes.get(p.id) ?? new Map<string, number>();
    const opts = parse<Record<string, string>>(p.options, {});
    const m = p.item_type === 'mcq' ? mcqById.get(p.item_id) : undefined;
    return {
      id: p.id, type: p.item_type, itemId: p.item_id, question: p.question,
      options: Object.entries(opts).map(([key, label]) => ({ key, label: String(label), n: tally.get(key) ?? 0 })),
      voters: [...tally.values()].reduce((a, b) => a + b, 0),
      createdAt: p.created_at, closesAt: p.closes_at, manual: !!p.closed, closed: !!p.closed || (p.closes_at != null && p.closes_at <= t), creator: p.creator,
      mcq: p.item_type === 'mcq' ? { qid: p.item_id, key: m?.key ?? '', href: `/practice/mcq?q=${encodeURIComponent(p.item_id)}` } : null,
    };
  }).sort((a, b) => Number(a.closed) - Number(b.closed));
}

export const POLL_KEYS = 'ABCDEF';
export function createPoll(actorId: number, b: Row): Result<{ poll: PollRow }> {
  const q = text(b.question, 200);
  if (!q) return { error: 'Write the question (up to 200 characters).' };
  const raw = Array.isArray(b.options) ? b.options : [];
  const opts = raw.map((o) => text(o, 100));
  if (raw.length < 2 || raw.length > 6 || opts.some((o) => !o)) return { error: 'Give 2 to 6 options, each up to 100 characters.' };
  if (new Set(opts.map((o) => o!.toLowerCase())).size !== opts.length) return { error: 'Each option must be different.' };
  const c = b.closesAt;
  if (c != null && c !== '' && (typeof c !== 'number' || !Number.isInteger(c) || c <= now() || c > now() + 366 * DAY)) return { error: 'The closing time must be in the next 12 months.' };
  const id = Number(db.prepare("INSERT INTO polls (item_type, item_id, question, options, created_by, created_at, closes_at) VALUES ('custom', NULL, ?, ?, ?, ?, ?)")
    .run(q, JSON.stringify(Object.fromEntries(opts.map((o, i) => [POLL_KEYS[i], o]))), actorId, now(), typeof c === 'number' ? c : null).lastInsertRowid);
  audit(actorId, 'poll.create', `#${id} ${clip(q, 80)}`);
  if (b.announce === true) notify('all', { kind: 'poll', title: 'New class poll', body: q, href: `/class#poll-${id}` }, actorId);
  return { poll: listPolls(id)[0] };
}

export function setPollClosed(actorId: number, id: number, closed: unknown): Result<{ poll: PollRow }> {
  if (typeof closed !== 'boolean') return { error: 'Say whether the poll is closed.' };
  const p = db.prepare('SELECT id, question, closes_at FROM polls WHERE id = ?').get(id) as Row | undefined;
  if (!p) return { error: 'Poll not found.', status: 404 };
  // Reopening a poll whose deadline passed clears the deadline, or it would stay closed.
  db.prepare('UPDATE polls SET closed = ?, closes_at = ? WHERE id = ?').run(Number(closed), !closed && p.closes_at != null && p.closes_at <= now() ? null : p.closes_at, id);
  audit(actorId, closed ? 'poll.close' : 'poll.reopen', `#${id} ${clip(p.question, 80)}`);
  return { poll: listPolls(id)[0] };
}

export function deletePoll(actorId: number, id: number): Result<{ ok: true }> {
  const p = db.prepare('SELECT question FROM polls WHERE id = ?').get(id) as Row | undefined;
  if (!p) return { error: 'Poll not found.', status: 404 };
  db.prepare('DELETE FROM polls WHERE id = ?').run(id);
  audit(actorId, 'poll.delete', `#${id} ${clip(p.question, 80)}`);
  return { ok: true };
}

// ---- AI-generated MCQs ----
export const AI_STATUS = ['pending', 'approved', 'rejected'] as const;
export interface AiFact { id: string; text: string; label: string | null; sub: string; missing?: boolean }
export interface AiRow { id: number; status: string; stem: string; options: string[]; key: string; explanation: string; facts: AiFact[]; topic: { slug: string; title: string; href: string } | null; creator: string | null; creatorName: string | null; reviewer: string | null; reviewedAt: number | null; createdAt: number }

export function listAiMcqs(status: unknown, limit = 100): AiRow[] {
  const s = pick(AI_STATUS, status) ?? 'pending';
  const rows = db.prepare(`SELECT m.*, u.username creator, u.display_name creatorName, r.username reviewer FROM ai_mcqs m
    LEFT JOIN users u ON u.id = m.created_by LEFT JOIN users r ON r.id = m.reviewed_by
    WHERE m.status = ? ORDER BY ${s === 'pending' ? 'm.created_at' : 'm.reviewed_at DESC, m.created_at DESC'} LIMIT ?`).all(s, limit) as Row[];
  return rows.map((m) => {
    const opts = parse<Record<string, string>>(m.options, {}), keys = Object.keys(opts).sort();
    const t = m.topic_slug ? topicBySlug.get(m.topic_slug) : undefined;
    return {
      id: m.id, status: m.status, stem: m.stem, options: keys.map((k) => String(opts[k])), key: m.key, explanation: m.explanation,
      facts: parse<unknown[]>(m.fact_ids, []).filter((x): x is string => typeof x === 'string').slice(0, 12).map((fid) => {
        const f = factById.get(fid);
        return f ? { id: f.id, text: f.fact, label: f.label, sub: `${shortFile(f.file)} p${f.unit}` } : { id: fid, text: 'Not in the current fact set.', label: null, sub: '', missing: true };
      }),
      topic: t ? { slug: t.slug, title: t.title, href: `/study/${t.system}/${t.slug}` } : null,
      creator: m.creator, creatorName: m.creatorName, reviewer: m.reviewer, reviewedAt: m.reviewed_at, createdAt: m.created_at,
    };
  });
}

export const aiCounts = () => {
  const c = Object.fromEntries(AI_STATUS.map((s) => [s, 0])) as Record<string, number>;
  for (const r of db.prepare('SELECT status, COUNT(*) n FROM ai_mcqs GROUP BY status').all() as { status: string; n: number }[]) c[r.status] = r.n;
  return c;
};

/** Client sends options as an ordered list; stored as {A: …, B: …}. */
export function checkMcq(b: Row): Result<{ stem: string; options: Record<string, string>; key: string; explanation: string }> {
  const stem = text(b.stem, 1500, 10);
  if (!stem) return { error: 'The stem needs 10 to 1500 characters.' };
  const raw = Array.isArray(b.options) ? b.options : [];
  const opts = raw.map((o) => text(o, 400));
  if (raw.length < 2 || raw.length > 6 || opts.some((o) => !o)) return { error: 'Give 2 to 6 options, each 1 to 400 characters.' };
  const keys = POLL_KEYS.slice(0, opts.length).split('');
  if (typeof b.key !== 'string' || !keys.includes(b.key)) return { error: 'The key must be one of the options.' };
  const explanation = text(b.explanation ?? '', 3000, 0);
  if (explanation === null) return { error: 'Keep the explanation to 3000 characters.' };
  return { stem, options: Object.fromEntries(opts.map((o, i) => [keys[i], o!])), key: b.key, explanation };
}

const aiRow = (id: number) => db.prepare('SELECT id, created_by, stem, status FROM ai_mcqs WHERE id = ?').get(id) as Row | undefined;
const saveMcq = (id: number, v: { stem: string; options: Record<string, string>; key: string; explanation: string }) =>
  db.prepare('UPDATE ai_mcqs SET stem = ?, options = ?, key = ?, explanation = ? WHERE id = ?').run(v.stem, JSON.stringify(v.options), v.key, v.explanation, id);

export function editAiMcq(actorId: number, id: number, b: Row): Result<{ ok: true }> {
  const m = aiRow(id);
  if (!m) return { error: 'Question not found.', status: 404 };
  if (m.status !== 'pending') return { error: 'Only pending questions can be edited.' };
  const v = checkMcq(b);
  if ('error' in v) return v;
  saveMcq(id, v);
  audit(actorId, 'aimcq.edit', `#${id}`);
  return { ok: true };
}

/** { decision: 'approve' | 'reject', reason?, edits? }. Edits are validated and saved with an approval. */
export function reviewAiMcq(actorId: number, id: number, b: Row): Result<{ status: string; reviewedAt: number }> {
  const m = aiRow(id);
  if (!m) return { error: 'Question not found.', status: 404 };
  if (m.status !== 'pending') return { error: `This question was already ${m.status}.` };
  const approve = b.decision === 'approve';
  if (!approve && b.decision !== 'reject') return { error: 'Approve or reject.' };
  const reason = approve ? '' : text(b.reason, 300);
  if (reason === null) return { error: 'Give a reason for rejecting (up to 300 characters).' };
  const edits = approve && b.edits && typeof b.edits === 'object' ? checkMcq(b.edits as Row) : null;
  if (edits && 'error' in edits) return edits;
  const t = now(), status = approve ? 'approved' : 'rejected';
  db.transaction(() => {
    if (edits) saveMcq(id, edits);
    db.prepare('UPDATE ai_mcqs SET status = ?, reviewed_by = ?, reviewed_at = ? WHERE id = ?').run(status, actorId, t, id);
  })();
  audit(actorId, `aimcq.${approve ? 'approve' : 'reject'}`, `#${id}${reason ? `: ${clip(reason, 80)}` : ''}`);
  if (m.created_by) notify(m.created_by, approve
    ? { kind: 'ai', title: 'Your AI question was approved', body: clip((edits ? edits.stem : m.stem) as string, 200), href: '/practice/ai' }
    : { kind: 'ai', title: 'Your AI question was not approved', body: reason, href: '/practice/ai' }, actorId);
  return { status, reviewedAt: t };
}

// ---- AI usage ----
export function aiUsage() {
  const from = dayStart() - 13 * DAY, keys = Array.from({ length: 14 }, (_, i) => dayKey(from + i * DAY));
  const at = new Map(keys.map((k, i) => [k, i]));
  const rows = db.prepare('SELECT a.user_id id, a.day, a.n, a.tokens, u.username, u.display_name name FROM ai_usage a JOIN users u ON u.id = a.user_id WHERE a.day >= ?').all(keys[0]) as Row[];
  const users = new Map<number, { id: number; username: string; name: string; n: number[]; tokens: number[]; total: number; totalTokens: number }>();
  const days = keys.map((day) => ({ day, n: 0, tokens: 0 }));
  for (const r of rows) {
    const i = at.get(r.day);
    if (i === undefined) continue;
    let u = users.get(r.id);
    if (!u) users.set(r.id, (u = { id: r.id, username: r.username, name: r.name, n: Array(14).fill(0), tokens: Array(14).fill(0), total: 0, totalTokens: 0 }));
    u.n[i] += r.n; u.tokens[i] += r.tokens; u.total += r.n; u.totalTokens += r.tokens;
    days[i].n += r.n; days[i].tokens += r.tokens;
  }
  const all = db.prepare('SELECT COALESCE(SUM(n), 0) n, COALESCE(SUM(tokens), 0) tokens FROM ai_usage').get() as { n: number; tokens: number };
  const cache = db.prepare('SELECT COUNT(*) entries, COALESCE(SUM(hits), 0) hits FROM ai_cache').get() as { entries: number; hits: number };
  return {
    days, users: [...users.values()].sort((a, b) => b.total - a.total || a.name.localeCompare(b.name)),
    total: days.reduce((s, d) => s + d.n, 0), tokens: days.reduce((s, d) => s + d.tokens, 0), allTime: all, cache,
  };
}

// ---- audit log ----
export const AUDIT_PAGE = 50;
export const ACTION_LABELS: Record<string, string> = {
  login: 'signed in', 'password.change': 'changed their password',
  'user.create': 'created the account', 'user.reset': 'reset the password of', 'user.enable': 'enabled', 'user.disable': 'disabled', 'user.role': 'changed the role of',
  announce: 'posted an announcement', 'announcement.create': 'posted an announcement', 'announcement.hide': 'took down announcement',
  'report.accept': 'accepted report', 'report.reject': 'rejected report', 'report.fix': 'marked fixed report',
  'comment.hide': 'hid comment', 'comment.unhide': 'restored comment', 'comment.delete': 'deleted comment',
  'poll.create': 'created poll', 'poll.close': 'closed poll', 'poll.reopen': 'reopened poll', 'poll.delete': 'deleted poll',
  'aimcq.edit': 'edited AI question', 'aimcq.approve': 'approved AI question', 'aimcq.reject': 'rejected AI question',
};
export const AREA_LABELS: Record<string, string> = { user: 'Accounts', login: 'Sign-ins', password: 'Passwords', announce: 'Announcements (old)', announcement: 'Announcements', report: 'Reports', comment: 'Comments', poll: 'Polls', aimcq: 'AI questions' };
export const actionLabel = (a: string) => ACTION_LABELS[a] ?? a.replace(/[._]/g, ' ');
const area = (a: string) => a.split('.')[0];

export function auditPage(q: { actor?: string | null; action?: string | null; q?: string | null; page?: string | null }) {
  const actor = intId(q.actor), prefix = typeof q.action === 'string' && /^[a-z_]{1,30}$/.test(q.action) ? q.action : null;
  const search = typeof q.q === 'string' ? q.q.trim().slice(0, 100) : '';
  const where: string[] = [], args: unknown[] = [];
  if (actor) { where.push('a.actor_id = ?'); args.push(actor); }
  if (prefix) { where.push("(a.action = ? OR a.action LIKE ? ESCAPE '\\')"); args.push(prefix, `${prefix.replace(/_/g, '\\_')}.%`); }
  if (search) { where.push("a.target LIKE ? ESCAPE '\\'"); args.push(`%${search.replace(/[\\%_]/g, (c) => '\\' + c)}%`); }
  const w = where.length ? `WHERE ${where.join(' AND ')}` : '';
  const total = one(`SELECT COUNT(*) n FROM audit_log a ${w}`, ...args);
  const pages = Math.max(1, Math.ceil(total / AUDIT_PAGE)), page = Math.min(Math.max(intId(q.page) || 1, 1), pages);
  const rows = db.prepare(`SELECT a.id, a.actor_id actorId, a.action, a.target, a.at, u.username, u.display_name name FROM audit_log a LEFT JOIN users u ON u.id = a.actor_id ${w} ORDER BY a.at DESC, a.id DESC LIMIT ? OFFSET ?`)
    .all(...args, AUDIT_PAGE, (page - 1) * AUDIT_PAGE) as { id: number; actorId: number | null; action: string; target: string | null; at: number; username: string | null; name: string | null }[];
  // Password resets store the user id; show the username.
  const ids = rows.filter((r) => r.action === 'user.reset' && /^\d+$/.test(r.target ?? '')).map((r) => Number(r.target));
  const names = new Map(ids.length ? (db.prepare('SELECT id, username FROM users WHERE id IN (SELECT value FROM json_each(?))').all(JSON.stringify(ids)) as { id: number; username: string }[]).map((u) => [String(u.id), u.username]) : []);
  return {
    total, page, pages, actor, prefix, search,
    rows: rows.map((r) => ({ ...r, area: area(r.action), label: actionLabel(r.action), target: r.action === 'user.reset' && names.has(r.target ?? '') ? names.get(r.target!)! : r.target ?? '' })),
    actors: db.prepare('SELECT DISTINCT u.id, u.username, u.display_name name FROM audit_log a JOIN users u ON u.id = a.actor_id ORDER BY u.username').all() as { id: number; username: string; name: string }[],
    areas: (db.prepare("SELECT DISTINCT CASE WHEN instr(action, '.') > 0 THEN substr(action, 1, instr(action, '.') - 1) ELSE action END p FROM audit_log ORDER BY p").all() as { p: string }[]).map((r) => r.p),
  };
}

export const recentAudit = (limit = 6) => auditPage({}).rows.slice(0, limit);

// ---- exports ----
function snapshot(type: string, id: string, cm: Map<string, CommentRef>) {
  if (type === 'fact') { const f = factById.get(id); if (f) return { type, id: f.id, statement: f.fact, status: f.status, label: f.label, basis: f.basis, file: f.file, unit: f.unit, sources: f.sources, edition: f.edition || null, paperDiffers: f.paperDiffers || null }; }
  if (type === 'mcq') { const m = mcqById.get(id); if (m) return { type, qid: m.qid, stem: m.stem, options: m.options, key: m.key, verdict: m.verdict, file: m.file, unit: m.unit }; }
  if (type === 'topic') { const t = topicBySlug.get(id); if (t) return { type, slug: t.slug, title: t.title, system: t.system }; }
  if (type === 'image') { const i = imageByFile.get(id); if (i) return { type, file: i.file, caption: i.caption, sourceFile: i.sourceFile, page: i.page }; }
  if (type === 'comment') { const c = cm.get(id); if (c) return { type, id: c.id, body: c.body, author: { username: c.username, displayName: c.name }, on: { type: c.item_type, id: c.item_id }, hidden: !!c.hidden, deleted: !!c.deleted }; }
  return { type, id, missing: true };
}

export function reportsExport() {
  const rows = db.prepare(`SELECT r.*, u.username, u.display_name name, v.username resolver FROM reports r JOIN users u ON u.id = r.user_id LEFT JOIN users v ON v.id = r.resolved_by ORDER BY r.id`).all() as Row[];
  const cm = commentsById(rows.filter((r) => r.item_type === 'comment').map((r) => r.item_id));
  return {
    exportedAt: iso(now()), count: rows.length,
    reports: rows.map((r) => ({
      id: r.id, kind: r.kind, status: r.status, body: r.body, quote: r.quote, path: r.path, resolution: r.resolution,
      reporter: { username: r.username, displayName: r.name }, resolvedBy: r.resolver, resolvedAt: iso(r.resolved_at), createdAt: iso(r.created_at),
      item: snapshot(r.item_type, r.item_id, cm),
    })),
  };
}

export function commentsExport() {
  const rows = db.prepare(`SELECT c.*, u.username, u.display_name name, h.username hider,
      (SELECT COUNT(*) FROM votes v WHERE v.item_type = 'comment' AND v.item_id = CAST(c.id AS TEXT)) votes
    FROM comments c JOIN users u ON u.id = c.user_id LEFT JOIN users h ON h.id = c.hidden_by ORDER BY c.id`).all() as Row[];
  return {
    exportedAt: iso(now()), count: rows.length,
    comments: rows.map((c) => ({
      id: c.id, parentId: c.parent_id, item: { type: c.item_type, id: c.item_id }, author: { username: c.username, displayName: c.name }, body: c.body, votes: c.votes,
      createdAt: iso(c.created_at), editedAt: iso(c.edited_at), deleted: !!c.deleted, hidden: !!c.hidden, hiddenBy: c.hider, hiddenReason: c.hidden_reason || null,
    })),
  };
}

/** RFC 4180 cell; a leading = + - @ is defused so spreadsheets never run it as a formula. */
export const csvCell = (v: unknown) => {
  let s = v == null ? '' : String(v);
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
};
export function usersCsv() {
  const rows = db.prepare('SELECT username, display_name, role, disabled, created_at, last_seen_at FROM users ORDER BY username').all() as Row[];
  const lines = [['username', 'display_name', 'role', 'disabled', 'created', 'last_seen'], ...rows.map((r) => [r.username, r.display_name, r.role, r.disabled ? 'yes' : 'no', iso(r.created_at), iso(r.last_seen_at)])];
  return '﻿' + lines.map((l) => l.map(csvCell).join(',')).join('\r\n') + '\r\n';
}

export const download = (body: string, name: string, type: string) =>
  new Response(body, { headers: { 'content-type': type, 'content-disposition': `attachment; filename="lightbox-${name}-${dayKey(now())}.${type.includes('csv') ? 'csv' : 'json'}"`, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' } });
