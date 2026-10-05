import { db, now } from './db';
import { notify } from './notify';
import { DAY, dayKey, dayStart } from './analytics';
import { intId, item, itemInfo, text, validPath } from './personal';
import { factById, mcqs } from '../lib/data';
import type { SessionUser } from './auth';

// Class layer: discussion threads, upvotes, reports, notifications, polls and the leaderboard.
// Everything here is user text: it is stored and served as plain text and never shown as verified.
export type Actor = Pick<SessionUser, 'id' | 'displayName' | 'role'>;
export const THREAD_TYPES = ['fact', 'topic', 'mcq', 'image', 'dispute'] as const;
export type ThreadType = (typeof THREAD_TYPES)[number];
export const REPORT_TYPES = ['fact', 'topic', 'mcq', 'image', 'comment'] as const;
export const REPORT_KINDS = ['wrong', 'source', 'typo', 'unclear', 'duplicate', 'offensive', 'other'] as const;
export type ReportKind = (typeof REPORT_KINDS)[number];
export const KIND_LABEL: Record<ReportKind, string> = { wrong: 'Wrong fact', source: 'Source problem', typo: 'Typo', unclear: 'Unclear', duplicate: 'Duplicate', offensive: 'Offensive', other: 'Other' };
export const LIMITS = { body: 2000, report: 1000, quote: 1000, comments: 8, commentWindow: 5 * 60_000, reports: 10, reportWindow: 3_600_000, thread: 1000 };

type Fail = { error: string; status: number };
const fail = (error: string, status = 400): Fail => ({ error, status });
const mcqById = new Map(mcqs.map((m) => [m.qid, m]));
const clip = (s: string, n: number) => (s.length > n ? s.slice(0, n - 1).trimEnd() + '…' : s);
const isDisputed = (id: string) => mcqById.get(id)?.verdict === 'DISPUTED' || factById.get(id)?.status === 'disputed';

/** A thread target named by the client: a real fact, topic, MCQ or image, or a disputed MCQ or fact. */
export function threadItem(type: unknown, id: unknown): { type: ThreadType; id: string } | null {
  if (type === 'dispute') return typeof id === 'string' && isDisputed(id) ? { type, id } : null;
  const it = item(0, type, id, false);
  return it && it.type !== 'card' ? { type: it.type, id: it.id } : null;
}

/** Title and link for anything a thread can hang on. Fact and topic pages scroll to their discussion. */
export function itemLink(type: string, id: string) {
  if (type === 'dispute') {
    const m = mcqById.get(id), title = m?.stem ?? factById.get(id)?.fact;
    return title ? { title, href: m ? '/review#mcqs' : '/review#open' } : null;
  }
  const i = itemInfo(0, type, id);
  return i ? { title: i.title, href: type === 'fact' || type === 'topic' ? `${i.href}#discussion` : i.href } : null;
}

const cleanBody = (v: unknown) => text(typeof v === 'string' ? v.replace(/\r\n?/g, '\n').replace(/\n{3,}/g, '\n\n') : v, LIMITS.body);

// ---- comments ----
export interface CommentView {
  id: number; parentId: number | null; author: { id: number; name: string; admin: boolean } | null; body: string;
  createdAt: number; editedAt: number | null; deleted: boolean; hidden: boolean; hiddenReason?: string; votes: number; mine: boolean; own: boolean;
}
type CommentRow = { id: number; parentId: number | null; uid: number; name: string; role: string; body: string; createdAt: number; editedAt: number | null; deleted: number; hidden: number; reason: string; votes: number; mine: number };
const SELECT = `SELECT c.id, c.parent_id parentId, c.user_id uid, u.display_name name, u.role, c.body, c.created_at createdAt, c.edited_at editedAt, c.deleted, c.hidden, c.hidden_reason reason,
  (SELECT COUNT(*) FROM votes v WHERE v.item_type = 'comment' AND v.item_id = CAST(c.id AS TEXT)) votes,
  EXISTS (SELECT 1 FROM votes v WHERE v.user_id = ? AND v.item_type = 'comment' AND v.item_id = CAST(c.id AS TEXT)) mine
  FROM comments c JOIN users u ON u.id = c.user_id`;

// Deleted comments keep a placeholder (their replies stay); hidden ones show their text only to admins.
function view(r: CommentRow, viewer: Actor): CommentView {
  const admin = viewer.role === 'admin', gone = !!r.deleted, masked = gone || (!!r.hidden && !admin);
  return {
    id: r.id, parentId: r.parentId, author: masked ? null : { id: r.uid, name: r.name, admin: r.role === 'admin' },
    body: masked ? '' : r.body, createdAt: r.createdAt, editedAt: gone ? null : r.editedAt, deleted: gone, hidden: !!r.hidden,
    ...(admin && r.hidden ? { hiddenReason: r.reason } : {}), votes: gone ? 0 : r.votes, mine: !!r.mine, own: r.uid === viewer.id,
  };
}

export function thread(viewer: Actor, it: { type: ThreadType; id: string }) {
  const rows = db.prepare(`${SELECT} WHERE c.item_type = ? AND c.item_id = ? ORDER BY c.id LIMIT ${LIMITS.thread}`).all(viewer.id, it.type, it.id) as CommentRow[];
  const live = new Set(rows.filter((r) => !r.deleted).map((r) => r.parentId));
  const comments = rows.filter((r) => !r.deleted || live.has(r.id)).map((r) => view(r, viewer));
  return { comments, count: rows.filter((r) => !r.deleted && !r.hidden).length };
}

const one = (viewer: Actor, id: number) => {
  const r = db.prepare(`${SELECT} WHERE c.id = ?`).get(viewer.id, id) as CommentRow | undefined;
  return r ? view(r, viewer) : null;
};
type Raw = { id: number; user_id: number; parent_id: number | null; item_type: string; item_id: string; deleted: number; hidden: number };
const raw = (id: number) => (id ? (db.prepare('SELECT id, user_id, parent_id, item_type, item_id, deleted, hidden FROM comments WHERE id = ?').get(id) as Raw | undefined) : undefined);

export function postComment(u: Actor, b: Record<string, unknown>): { comment: CommentView } | Fail {
  const it = threadItem(b.type, b.id);
  if (!it) return fail('Unknown item.');
  const body = cleanBody(b.body);
  if (!body) return fail(`Write something, up to ${LIMITS.body} characters.`);
  const parent = b.parentId == null ? undefined : raw(intId(b.parentId));
  if (b.parentId != null && (!parent || parent.item_type !== it.type || parent.item_id !== it.id || parent.deleted)) return fail('That comment is no longer there.', 404);
  // ponytail: admins are trusted and skip the rate limit (they moderate and test); add a role check here if that changes.
  if (u.role !== 'admin' && (db.prepare('SELECT COUNT(*) n FROM comments WHERE user_id = ? AND created_at > ?').get(u.id, now() - LIMITS.commentWindow) as { n: number }).n >= LIMITS.comments)
    return fail("You're posting quickly. Wait a few minutes, then try again.", 429);
  const id = Number(db.prepare('INSERT INTO comments (user_id, item_type, item_id, parent_id, body, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(u.id, it.type, it.id, parent ? (parent.parent_id ?? parent.id) : null, body, now()).lastInsertRowid);
  if (parent && parent.user_id !== u.id)
    notify(parent.user_id, { kind: 'reply', title: `${u.displayName} replied to your comment`, body: clip(body, 160), href: itemLink(it.type, it.id)?.href });
  return { comment: one(u, id)! };
}

export function editComment(u: Actor, id: number, body: unknown): { comment: CommentView } | Fail {
  const c = raw(id), s = cleanBody(body);
  if (!c || c.user_id !== u.id || c.deleted) return fail('Comment not found.', 404);
  if (c.hidden) return fail('A moderator hid this comment, so it cannot be edited.', 403);
  if (!s) return fail(`Write something, up to ${LIMITS.body} characters.`);
  db.prepare('UPDATE comments SET body = ?, edited_at = ? WHERE id = ? AND user_id = ?').run(s, now(), id, u.id);
  return { comment: one(u, id)! };
}

/** Soft delete: the row stays so replies keep their place; the text is never served again. */
export const deleteComment = (u: Actor, id: number) =>
  db.prepare('UPDATE comments SET deleted = 1 WHERE id = ? AND user_id = ? AND deleted = 0').run(id, u.id).changes > 0;

// ---- votes ----
export function voteComment(u: Actor, id: number, on: boolean): { votes: number; mine: boolean } | Fail {
  const c = raw(id);
  if (!c || c.deleted || c.hidden) return fail('Comment not found.', 404);
  if (c.user_id === u.id) return fail("You can't upvote your own comment.", 403);
  if (on) db.prepare("INSERT OR IGNORE INTO votes (user_id, item_type, item_id, created_at) VALUES (?, 'comment', ?, ?)").run(u.id, String(id), now());
  else db.prepare("DELETE FROM votes WHERE user_id = ? AND item_type = 'comment' AND item_id = ?").run(u.id, String(id));
  const votes = (db.prepare("SELECT COUNT(*) n FROM votes WHERE item_type = 'comment' AND item_id = ?").get(String(id)) as { n: number }).n;
  return { votes, mine: on };
}

// ---- reports ----
export function fileReport(u: Actor, b: Record<string, unknown>): { id: number } | Fail {
  const type = b.type, kind = b.kind as ReportKind;
  if (!REPORT_TYPES.includes(type as never)) return fail('Unknown item.');
  let target: { type: string; id: string; title: string } | null = null;
  if (type === 'comment') {
    const c = typeof b.id === 'string' && /^\d{1,12}$/.test(b.id) ? raw(Number(b.id)) : undefined;
    const by = c && (db.prepare('SELECT display_name n FROM users WHERE id = ?').get(c.user_id) as { n: string } | undefined);
    if (c && !c.deleted) target = { type, id: String(c.id), title: `a comment by ${by?.n ?? 'a classmate'}` };
  } else {
    const it = threadItem(type, b.id), l = it && itemLink(it.type, it.id);
    if (it && l) target = { type: it.type, id: it.id, title: clip(l.title, 90) };
  }
  if (!target) return fail('Unknown item.');
  if (!REPORT_KINDS.includes(kind) || (kind === 'offensive' && type !== 'comment')) return fail('Choose what is wrong.');
  const body = text(b.body ?? '', LIMITS.report, 0), quote = text(b.quote ?? '', LIMITS.quote, 0);
  if (body === null) return fail(`Keep the details under ${LIMITS.report} characters.`);
  if (quote === null) return fail('The quoted text is too long.');
  if (db.prepare("SELECT 1 FROM reports WHERE user_id = ? AND item_type = ? AND item_id = ? AND kind = ? AND status = 'open'").get(u.id, target.type, target.id, kind))
    return fail('You already reported this. An admin will look at it soon.', 409);
  if (u.role !== 'admin' && (db.prepare('SELECT COUNT(*) n FROM reports WHERE user_id = ? AND created_at > ?').get(u.id, now() - LIMITS.reportWindow) as { n: number }).n >= LIMITS.reports)
    return fail("That's a lot of reports in an hour. Try again a little later.", 429);
  const id = Number(db.prepare('INSERT INTO reports (user_id, item_type, item_id, kind, body, quote, path, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)')
    .run(u.id, target.type, target.id, kind, body, quote, validPath(b.path), now()).lastInsertRowid);
  notify('admins', { kind: 'report', title: `New report: ${KIND_LABEL[kind]}`, body: `${u.displayName} on ${target.title}`, href: '/admin?tab=moderation' }, u.id);
  return { id };
}

// ---- notifications ----
export interface Notification { id: number; kind: string; title: string; body: string; href: string | null; createdAt: number; readAt: number | null }
export const unreadCount = (uid: number) => (db.prepare('SELECT COUNT(*) n FROM notifications WHERE user_id = ? AND read_at IS NULL').get(uid) as { n: number }).n;
export const listNotifications = (uid: number, limit = 15, unreadOnly = false) =>
  db.prepare(`SELECT id, kind, title, body, href, created_at createdAt, read_at readAt FROM notifications WHERE user_id = ?${unreadOnly ? ' AND read_at IS NULL' : ''}
              ORDER BY created_at DESC, id DESC LIMIT ?`).all(uid, Math.max(1, Math.min(200, limit))) as Notification[];

/** ids = specific notifications, or 'all'. Returns how many changed. */
export function markRead(uid: number, ids: number[] | 'all') {
  if (ids === 'all') return db.prepare('UPDATE notifications SET read_at = ? WHERE user_id = ? AND read_at IS NULL').run(now(), uid).changes;
  const set = db.prepare('UPDATE notifications SET read_at = ? WHERE id = ? AND user_id = ? AND read_at IS NULL');
  return db.transaction(() => ids.reduce((n, id) => n + set.run(now(), id, uid).changes, 0))();
}

// ---- polls ----
type PollRow = { id: number; item_type: 'mcq' | 'custom'; item_id: string | null; question: string; options: string; closes_at: number | null; closed: number; created_at: number };
export interface PollView {
  id: number; kind: 'mcq' | 'custom'; itemId: string | null; question: string; context: string | null; href: string | null;
  options: { key: string; label: string; votes?: number }[]; total: number; mine: string | null; open: boolean; closesAt: number | null;
}
const options = (json: string) => {
  try { return Object.entries(JSON.parse(json) as Record<string, unknown>).filter((e): e is [string, string] => typeof e[1] === 'string'); } catch { return []; }
};
const isOpen = (p: PollRow) => !p.closed && (!p.closes_at || p.closes_at > now());
export const pollEligible = (qid: string) => {
  const m = mcqById.get(qid);
  return !!m && Object.keys(m.options).length >= 2 && (m.verdict === 'DISPUTED' || !m.key);
};

/** The class poll for a disputed or unkeyed MCQ, created on first request. */
export function mcqPoll(qid: string) {
  if (!pollEligible(qid)) return null;
  db.prepare("INSERT OR IGNORE INTO polls (item_type, item_id, question, options, created_at) VALUES ('mcq', ?, 'Which answer would you choose?', ?, ?)")
    .run(qid, JSON.stringify(mcqById.get(qid)!.options), now());
  return db.prepare("SELECT * FROM polls WHERE item_type = 'mcq' AND item_id = ?").get(qid) as PollRow;
}
export const pollById = (id: number) => db.prepare('SELECT * FROM polls WHERE id = ?').get(id) as PollRow | undefined;

/** Counts stay hidden until you vote (or the poll closes), so early votes don't steer later ones. */
export function pollView(uid: number, p: PollRow): PollView {
  const counts = new Map((db.prepare('SELECT choice, COUNT(*) n FROM poll_votes WHERE poll_id = ? GROUP BY choice').all(p.id) as { choice: string; n: number }[]).map((r) => [r.choice, r.n]));
  const mine = (db.prepare('SELECT choice FROM poll_votes WHERE poll_id = ? AND user_id = ?').get(p.id, uid) as { choice: string } | undefined)?.choice ?? null;
  const open = isOpen(p), show = !!mine || !open, m = p.item_type === 'mcq' ? mcqById.get(p.item_id ?? '') : undefined;
  return {
    id: p.id, kind: p.item_type, itemId: p.item_id, question: p.question, context: m?.stem ?? null, href: m ? `/practice/mcq?q=${encodeURIComponent(m.qid)}` : null,
    options: options(p.options).map(([key, label]) => (show ? { key, label, votes: counts.get(key) ?? 0 } : { key, label })),
    total: [...counts.values()].reduce((a, b) => a + b, 0), mine, open, closesAt: p.closes_at,
  };
}

export function votePoll(uid: number, id: number, choice: unknown): PollView | Fail {
  const p = pollById(id);
  if (!p) return fail('Poll not found.', 404);
  if (!isOpen(p)) return fail('This poll has closed.', 409);
  if (typeof choice !== 'string' || !options(p.options).some(([k]) => k === choice)) return fail('Choose one of the options.');
  db.prepare(`INSERT INTO poll_votes (poll_id, user_id, choice, created_at) VALUES (?, ?, ?, ?)
              ON CONFLICT (poll_id, user_id) DO UPDATE SET choice = excluded.choice, created_at = excluded.created_at`).run(id, uid, choice, now());
  return pollView(uid, p);
}

// Custom polls from the admin, plus disputed-MCQ polls with a vote in the last two weeks.
const OPEN_POLLS = `FROM polls p WHERE p.closed = 0 AND (p.closes_at IS NULL OR p.closes_at > ?)
  AND (p.item_type = 'custom' OR EXISTS (SELECT 1 FROM poll_votes v WHERE v.poll_id = p.id AND v.created_at > ?))`;
export const openPolls = (limit = 6) =>
  db.prepare(`SELECT p.* ${OPEN_POLLS} ORDER BY p.item_type = 'custom' DESC, p.created_at DESC LIMIT ?`).all(now(), now() - 14 * DAY, limit) as PollRow[];

// ---- class hub ----
export function classStats() {
  const n = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(...a) as { n: number }).n;
  return {
    members: n('SELECT COUNT(*) n FROM users WHERE disabled = 0'),
    activeToday: n('SELECT COUNT(*) n FROM users WHERE disabled = 0 AND last_seen_at >= ?', dayStart()),
    discussions: n('SELECT COUNT(*) n FROM comments WHERE deleted = 0 AND hidden = 0 AND created_at > ?', now() - 7 * DAY),
    openPolls: n(`SELECT COUNT(*) n ${OPEN_POLLS}`, now(), now() - 14 * DAY),
  };
}

export interface FeedItem { id: number; author: string; body: string; createdAt: number; reply: boolean; type: string; title: string; href: string }
export function feed(limit = 10): FeedItem[] {
  const rows = db.prepare(`SELECT c.id, u.display_name author, c.body, c.created_at createdAt, c.parent_id parentId, c.item_type type, c.item_id itemId
    FROM comments c JOIN users u ON u.id = c.user_id WHERE c.deleted = 0 AND c.hidden = 0 AND u.disabled = 0 ORDER BY c.created_at DESC, c.id DESC LIMIT ?`).all(Math.min(50, limit)) as
    { id: number; author: string; body: string; createdAt: number; parentId: number | null; type: string; itemId: string }[];
  return rows.flatMap((r) => {
    const l = itemLink(r.type, r.itemId);
    return l ? [{ id: r.id, author: r.author, body: clip(r.body, 280), createdAt: r.createdAt, reply: r.parentId !== null, type: r.type, title: clip(l.title, 120), href: l.href }] : [];
  });
}

// ---- leaderboard ----
export const POINTS = { review: 1, mcq: 2, exam: 1, upvote: 3, streakDay: 5 } as const;
export const STREAK_CAP = { week: 7, all: 30 } as const;
export type Board = keyof typeof STREAK_CAP;
export interface Standing { rank: number; id: number; name: string; admin: boolean; points: number; streak: number; cards: number; solved: number; right: number; keyed: number; exam: number; upvotes: number }

function compute(board: Board): Standing[] {
  const t = now(), today = dayStart(t), since = board === 'week' ? today - 6 * DAY : 0;
  const by = <T extends { id: number }>(sql: string, ...a: unknown[]) => new Map((db.prepare(sql).all(...a) as T[]).map((r) => [r.id, r]));
  const reviews = by<{ id: number; n: number }>('SELECT user_id id, COUNT(*) n FROM srs_log WHERE reviewed_at >= ? GROUP BY user_id', since);
  const mcq = by<{ id: number; solved: number; hits: number; keyed: number }>(`SELECT user_id id, COUNT(DISTINCT CASE WHEN correct = 1 THEN qid END) solved,
    SUM(correct = 1) hits, SUM(correct IS NOT NULL) keyed FROM mcq_attempts WHERE created_at >= ? GROUP BY user_id`, since);
  const exam = by<{ id: number; n: number }>('SELECT e.user_id id, COUNT(*) n FROM exam_answers a JOIN exams e ON e.id = a.exam_id WHERE a.choice IS NOT NULL AND a.answered_at >= ? GROUP BY e.user_id', since);
  const ups = by<{ id: number; n: number }>(`SELECT c.user_id id, COUNT(*) n FROM votes v JOIN comments c ON c.id = CAST(v.item_id AS INTEGER)
    WHERE v.item_type = 'comment' AND c.deleted = 0 AND c.hidden = 0 AND v.created_at >= ? GROUP BY c.user_id`, since);
  // Streak: consecutive days with a review or an answer, counted back from today (or yesterday), as on the home page.
  const days = new Map<number, Set<string>>();
  for (const r of db.prepare(`SELECT user_id id, t FROM (SELECT user_id, reviewed_at t FROM srs_log WHERE reviewed_at >= ? UNION ALL SELECT user_id, created_at FROM mcq_attempts WHERE created_at >= ?)
    GROUP BY user_id, (t + 18000000) / 86400000`).all(today - 31 * DAY, today - 31 * DAY) as { id: number; t: number }[])
    (days.get(r.id) ?? days.set(r.id, new Set()).get(r.id)!).add(dayKey(r.t));
  const streak = (id: number) => {
    const s = days.get(id);
    let n = 0;
    if (s) for (let d = s.has(dayKey(t)) ? t : t - DAY; s.has(dayKey(d)); d -= DAY) n++;
    return n;
  };
  const users = db.prepare('SELECT id, display_name name, role FROM users WHERE disabled = 0').all() as { id: number; name: string; role: string }[];
  const rows = users.map((u) => {
    const m = mcq.get(u.id), s = streak(u.id);
    const r = { id: u.id, name: u.name, admin: u.role === 'admin', streak: s, cards: reviews.get(u.id)?.n ?? 0, solved: m?.solved ?? 0, right: m?.hits ?? 0, keyed: m?.keyed ?? 0, exam: exam.get(u.id)?.n ?? 0, upvotes: ups.get(u.id)?.n ?? 0 };
    return { ...r, rank: 0, points: r.cards * POINTS.review + r.solved * POINTS.mcq + r.exam * POINTS.exam + r.upvotes * POINTS.upvote + Math.min(s, STREAK_CAP[board]) * POINTS.streakDay };
  }).sort((a, b) => b.points - a.points || b.streak - a.streak || a.name.localeCompare(b.name));
  rows.forEach((r, i) => (r.rank = i && rows[i - 1].points === r.points ? rows[i - 1].rank : i + 1));
  return rows;
}

// ponytail: per-process 60 s memo; the board is a handful of grouped scans, recompute per request if it ever needs to be live.
const memo = new Map<Board, { at: number; rows: Standing[] }>();
export function leaderboard(board: Board) {
  const m = memo.get(board);
  if (m && m.at > now() - 60_000) return m.rows;
  const rows = compute(board);
  memo.set(board, { at: now(), rows });
  return rows;
}
export const clearLeaderboard = () => memo.clear();
