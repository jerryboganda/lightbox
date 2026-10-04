import { db, now } from './db';
import { factById, images, mcqs, shortFile, SYSTEMS, topicBySlug } from '../lib/data';

// Personal layer: marks, collections, notes, highlights, user cards and history. Every query is scoped to the caller.
export const ITEM_TYPES = ['fact', 'topic', 'mcq', 'image', 'card'] as const;
export type ItemType = (typeof ITEM_TYPES)[number];
export type MarkKind = 'bookmark' | 'weak';
export const COLORS = ['amber', 'cyan', 'green', 'violet'] as const;
export type Color = (typeof COLORS)[number];
export interface Item { type: ItemType; id: string }

export const LIMITS = { name: 80, description: 500, note: 5000, quote: 1000, hlNote: 1000, front: 1000, back: 2000, collections: 100, items: 500, highlights: 5000, cards: 2000 };
const TZ_MS = 5 * 3_600_000;
export const dayKey = (t: number) => new Date(t + TZ_MS).toISOString().slice(0, 10);

const mcqById = new Map(mcqs.map((m) => [m.qid, m]));
const imageByFile = new Map(images.map((i) => [i.file, i]));

/** Trimmed string within [min, max] chars, else null. */
export const text = (v: unknown, max: number, min = 1) => {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length >= min && s.length <= max ? s : null;
};
/** Positive integer id, else 0. */
export const intId = (v: unknown) => {
  const n = Number(v);
  return Number.isSafeInteger(n) && n > 0 ? n : 0;
};
/** JSON object body, else null. */
export const readBody = async (r: Request) => {
  const b = await r.json().catch(() => null);
  return b && typeof b === 'object' && !Array.isArray(b) ? (b as Record<string, unknown>) : null;
};
export const fail = (error: string, status = 400) => Response.json({ error }, { status });
const cardNum = (id: string) => (/^U[1-9]\d{0,12}$/.test(id) ? Number(id.slice(1)) : 0);
const ownsCard = (uid: number, n: number) => !!n && !!db.prepare('SELECT 1 FROM user_cards WHERE id = ? AND user_id = ?').get(n, uid);

/** Validates an item reference from the client. User cards ('U<id>') only resolve for their owner. */
export function item(uid: number, type: unknown, id: unknown, allowCard = true): Item | null {
  if (typeof id !== 'string' || !id || id.length > 200) return null;
  const ok = type === 'fact' ? factById.has(id) : type === 'topic' ? topicBySlug.has(id) : type === 'mcq' ? mcqById.has(id)
    : type === 'image' ? imageByFile.has(id) : type === 'card' ? allowCard && ownsCard(uid, cardNum(id)) : false;
  return ok ? { type: type as ItemType, id } : null;
}

export interface ItemInfo { type: string; id: string; title: string; sub: string; href: string; label?: string; image?: string }
/** Display data for an item, from existing fields only. */
export function itemInfo(uid: number, type: string, id: string): ItemInfo | null {
  if (type === 'fact') {
    const f = factById.get(id);
    return f ? { type, id, title: f.fact, sub: `${f.id} · ${shortFile(f.file)} p${f.unit}`, href: `/facts/${f.id}`, label: f.label } : null;
  }
  if (type === 'topic') {
    const t = topicBySlug.get(id);
    return t ? { type, id, title: t.title, sub: `${SYSTEMS[t.system]?.label ?? 'Topic'} · ${t.oneLiner}`, href: `/study/${t.system}/${t.slug}` } : null;
  }
  if (type === 'mcq') {
    const m = mcqById.get(id);
    return m ? { type, id, title: m.stem, sub: `${m.qid} · ${shortFile(m.file)} p${m.unit}`, href: `/practice/mcq?q=${encodeURIComponent(m.qid)}` } : null;
  }
  if (type === 'image') {
    const i = imageByFile.get(id);
    return i ? { type, id, title: i.caption.split('\n')[0]?.trim() || 'No source caption', sub: `${shortFile(i.sourceFile)}${i.page ? ` · p${i.page}` : ''}`, href: `/atlas?img=${encodeURIComponent(i.file)}`, image: i.file } : null;
  }
  if (type === 'card') {
    const c = db.prepare('SELECT front, fact_id FROM user_cards WHERE id = ? AND user_id = ?').get(cardNum(id), uid) as { front: string; fact_id: string | null } | undefined;
    return c ? { type, id, title: c.front, sub: c.fact_id ? `Your card · from ${c.fact_id}` : 'Your card', href: `/library?tab=cards#card-${id}` } : null;
  }
  return null;
}

// ---- marks ----
export const listMarks = (uid: number) =>
  db.prepare('SELECT item_type type, item_id id, kind, created_at at FROM marks WHERE user_id = ? ORDER BY created_at DESC').all(uid) as (Item & { kind: MarkKind; at: number })[];

export function setMark(uid: number, it: Item, kind: unknown, on: boolean) {
  if (kind !== 'bookmark' && kind !== 'weak') return false;
  if (on) db.prepare('INSERT OR IGNORE INTO marks (user_id, item_type, item_id, kind, created_at) VALUES (?, ?, ?, ?, ?)').run(uid, it.type, it.id, kind, now());
  else db.prepare('DELETE FROM marks WHERE user_id = ? AND item_type = ? AND item_id = ? AND kind = ?').run(uid, it.type, it.id, kind);
  return true;
}

// ---- collections ----
export interface Collection { id: number; name: string; description: string; shared: number; updatedAt: number; count: number; has?: number }
const COLS = `c.id, c.name, c.description, c.shared, c.updated_at updatedAt, (SELECT COUNT(*) FROM collection_items i WHERE i.collection_id = c.id) count`;

export function listCollections(uid: number, it?: Item | null) {
  const has = it ? ', EXISTS (SELECT 1 FROM collection_items i WHERE i.collection_id = c.id AND i.item_type = ? AND i.item_id = ?) has' : '';
  return db.prepare(`SELECT ${COLS}${has} FROM collections c WHERE c.user_id = ? ORDER BY c.updated_at DESC`).all(...(it ? [it.type, it.id, uid] : [uid])) as Collection[];
}

const owned = (uid: number, cid: number) => !!db.prepare('SELECT 1 FROM collections WHERE id = ? AND user_id = ?').get(cid, uid);
const touch = (cid: number) => db.prepare('UPDATE collections SET updated_at = ? WHERE id = ?').run(now(), cid);

export function createCollection(uid: number, name: unknown, description: unknown = '') {
  const n = text(name, LIMITS.name), d = text(description ?? '', LIMITS.description, 0);
  if (n === null || d === null) return { error: 'Give the collection a name (up to 80 characters).' } as const;
  if ((db.prepare('SELECT COUNT(*) n FROM collections WHERE user_id = ?').get(uid) as { n: number }).n >= LIMITS.collections) return { error: 'You have reached 100 collections.' } as const;
  const t = now();
  const id = Number(db.prepare('INSERT INTO collections (user_id, name, description, shared, created_at, updated_at) VALUES (?, ?, ?, 0, ?, ?)').run(uid, n, d, t, t).lastInsertRowid);
  return { id } as const;
}

export function updateCollection(uid: number, cid: number, patch: { name?: unknown; description?: unknown; shared?: unknown }) {
  if (!owned(uid, cid)) return 'missing';
  const n = patch.name === undefined ? undefined : text(patch.name, LIMITS.name);
  const d = patch.description === undefined ? undefined : text(patch.description, LIMITS.description, 0);
  const s = patch.shared === undefined ? undefined : typeof patch.shared === 'boolean' ? Number(patch.shared) : null;
  if (n === null || d === null || s === null) return 'invalid';
  db.prepare(`UPDATE collections SET name = COALESCE(?, name), description = COALESCE(?, description), shared = COALESCE(?, shared), updated_at = ? WHERE id = ? AND user_id = ?`)
    .run(n ?? null, d ?? null, s ?? null, now(), cid, uid);
  return 'ok';
}

export const deleteCollection = (uid: number, cid: number) => db.prepare('DELETE FROM collections WHERE id = ? AND user_id = ?').run(cid, uid).changes > 0;

/** The collection if the caller owns it or it is shared with the class. */
export function getCollection(uid: number, cid: number) {
  const row = db.prepare(`SELECT ${COLS}, c.user_id ownerId, c.created_at createdAt, u.display_name ownerName, u.disabled FROM collections c JOIN users u ON u.id = c.user_id WHERE c.id = ?`).get(cid) as
    (Collection & { ownerId: number; ownerName: string; createdAt: number; disabled: number }) | undefined;
  if (!row || (row.ownerId !== uid && (!row.shared || row.disabled))) return null;
  const { disabled: _, ...c } = row;
  const items = db.prepare('SELECT item_type type, item_id id FROM collection_items WHERE collection_id = ? ORDER BY position, added_at').all(cid) as Item[];
  return { ...c, owner: c.ownerId === uid, items };
}

export function setCollectionItem(uid: number, cid: number, it: Item, on: boolean) {
  if (!owned(uid, cid) || it.type === 'card') return false;
  if (on) {
    const n = (db.prepare('SELECT COUNT(*) n, COALESCE(MAX(position), -1) p FROM collection_items WHERE collection_id = ?').get(cid) as { n: number; p: number });
    if (n.n >= LIMITS.items) return false;
    db.prepare('INSERT OR IGNORE INTO collection_items (collection_id, item_type, item_id, position, added_at) VALUES (?, ?, ?, ?, ?)').run(cid, it.type, it.id, n.p + 1, now());
  } else db.prepare('DELETE FROM collection_items WHERE collection_id = ? AND item_type = ? AND item_id = ?').run(cid, it.type, it.id);
  touch(cid);
  return true;
}

/** Applies a new order; items not listed keep their relative order after the listed ones. */
export function reorderCollection(uid: number, cid: number, order: unknown) {
  if (!owned(uid, cid) || !Array.isArray(order) || order.length > LIMITS.items) return false;
  const set = db.prepare('UPDATE collection_items SET position = ? WHERE collection_id = ? AND item_type = ? AND item_id = ?');
  db.transaction(() => {
    db.prepare('UPDATE collection_items SET position = position + ? WHERE collection_id = ?').run(order.length, cid);
    order.forEach((o, i) => { if (o && typeof o.type === 'string' && typeof o.id === 'string') set.run(i, cid, o.type, o.id); });
    touch(cid);
  })();
  return true;
}

export const sharedCollections = () =>
  db.prepare(`SELECT ${COLS}, c.user_id ownerId, u.display_name ownerName FROM collections c JOIN users u ON u.id = c.user_id
              WHERE c.shared = 1 AND u.disabled = 0 ORDER BY c.updated_at DESC LIMIT 200`).all() as (Collection & { ownerId: number; ownerName: string })[];

export function copyCollection(uid: number, cid: number) {
  const src = getCollection(uid, cid);
  if (!src) return null;
  const made = createCollection(uid, src.owner ? `${src.name} (copy)`.slice(0, LIMITS.name) : src.name, src.description);
  if ('error' in made) return null;
  const add = db.prepare('INSERT INTO collection_items (collection_id, item_type, item_id, position, added_at) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => src.items.forEach((it, i) => add.run(made.id, it.type, it.id, i, now())))();
  return made.id;
}

// ---- notes ----
export const getNote = (uid: number, it: Item) =>
  db.prepare('SELECT body, updated_at updatedAt FROM notes WHERE user_id = ? AND item_type = ? AND item_id = ?').get(uid, it.type, it.id) as { body: string; updatedAt: number } | undefined;

/** Saves a note; an empty body deletes it. Returns the save time, or null when the body is too long. */
export function saveNote(uid: number, it: Item, body: unknown) {
  if (typeof body !== 'string' || body.length > LIMITS.note) return null;
  const t = now();
  if (!body.trim()) db.prepare('DELETE FROM notes WHERE user_id = ? AND item_type = ? AND item_id = ?').run(uid, it.type, it.id);
  else db.prepare(`INSERT INTO notes (user_id, item_type, item_id, body, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)
                   ON CONFLICT (user_id, item_type, item_id) DO UPDATE SET body = excluded.body, updated_at = excluded.updated_at`).run(uid, it.type, it.id, body, t, t);
  return t;
}

export const listNotes = (uid: number) =>
  db.prepare('SELECT item_type type, item_id id, body, updated_at updatedAt FROM notes WHERE user_id = ? ORDER BY updated_at DESC').all(uid) as (Item & { body: string; updatedAt: number })[];

// ---- highlights ----
export interface Highlight { id: number; path: string; quote: string; prefix: string; suffix: string; color: Color; note: string; factId: string | null; createdAt: number }
const HL = 'id, path, quote, prefix, suffix, color, note, fact_id factId, created_at createdAt';
// Same-origin pathname only: no scheme, host, query, fragment or protocol-relative '//'.
export const validPath = (p: unknown) => (typeof p === 'string' && /^\/(?!\/)[^\s"'<>\\?#]{0,299}$/.test(p) ? p : null);
const isColor = (c: unknown): c is Color => COLORS.includes(c as Color);

export const listHighlights = (uid: number, path: string) =>
  db.prepare(`SELECT ${HL} FROM highlights WHERE user_id = ? AND path = ? ORDER BY id`).all(uid, path) as Highlight[];
export const allHighlights = (uid: number) =>
  db.prepare(`SELECT ${HL} FROM highlights WHERE user_id = ? ORDER BY created_at DESC LIMIT 1000`).all(uid) as Highlight[];

export function addHighlight(uid: number, h: Record<string, unknown>) {
  const path = validPath(h.path), quote = text(h.quote, LIMITS.quote);
  const prefix = typeof h.prefix === 'string' ? h.prefix.slice(-64) : '', suffix = typeof h.suffix === 'string' ? h.suffix.slice(0, 64) : '';
  const note = h.note === undefined ? '' : text(h.note, LIMITS.hlNote, 0);
  const color = h.color === undefined ? 'amber' : h.color;
  if (!path || !quote || note === null || !isColor(color)) return null;
  if ((db.prepare('SELECT COUNT(*) n FROM highlights WHERE user_id = ?').get(uid) as { n: number }).n >= LIMITS.highlights) return null;
  const factId = typeof h.factId === 'string' && factById.has(h.factId) ? h.factId : null;
  return Number(db.prepare('INSERT INTO highlights (user_id, path, quote, prefix, suffix, color, note, fact_id, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
    .run(uid, path, quote, prefix, suffix, color, note, factId, now()).lastInsertRowid);
}

export function updateHighlight(uid: number, id: number, patch: { color?: unknown; note?: unknown }) {
  const note = patch.note === undefined ? undefined : text(patch.note, LIMITS.hlNote, 0);
  if (note === null || (patch.color !== undefined && !isColor(patch.color))) return false;
  return db.prepare('UPDATE highlights SET color = COALESCE(?, color), note = COALESCE(?, note) WHERE id = ? AND user_id = ?')
    .run((patch.color as Color | undefined) ?? null, note ?? null, id, uid).changes > 0;
}

export const deleteHighlight = (uid: number, id: number) => db.prepare('DELETE FROM highlights WHERE id = ? AND user_id = ?').run(id, uid).changes > 0;

// ---- user cards (scheduled in srs_cards / srs_log as 'U<id>') ----
export interface UserCard { id: number; front: string; back: string; factId: string | null; path: string | null; createdAt: number; due: number | null; state: number | null }

export function createUserCard(uid: number, c: Record<string, unknown>) {
  const front = text(c.front, LIMITS.front), back = text(c.back, LIMITS.back);
  if (!front || !back) return null;
  if ((db.prepare('SELECT COUNT(*) n FROM user_cards WHERE user_id = ?').get(uid) as { n: number }).n >= LIMITS.cards) return null;
  const factId = typeof c.factId === 'string' && factById.has(c.factId) ? c.factId : null;
  return Number(db.prepare('INSERT INTO user_cards (user_id, front, back, fact_id, path, created_at) VALUES (?, ?, ?, ?, ?, ?)')
    .run(uid, front, back, factId, validPath(c.path), now()).lastInsertRowid);
}

export function updateUserCard(uid: number, id: number, c: Record<string, unknown>) {
  const front = text(c.front, LIMITS.front), back = text(c.back, LIMITS.back);
  if (!front || !back) return 'invalid';
  return db.prepare('UPDATE user_cards SET front = ?, back = ? WHERE id = ? AND user_id = ?').run(front, back, id, uid).changes ? 'ok' : 'missing';
}

/** Removes the card and its schedule. The review log stays so streaks and history keep their past. */
export const deleteUserCard = (uid: number, id: number) => db.transaction(() => {
  if (!db.prepare('DELETE FROM user_cards WHERE id = ? AND user_id = ?').run(id, uid).changes) return false;
  db.prepare('DELETE FROM srs_cards WHERE user_id = ? AND fact_id = ?').run(uid, `U${id}`);
  db.prepare("DELETE FROM marks WHERE user_id = ? AND item_type = 'card' AND item_id = ?").run(uid, `U${id}`);
  db.prepare("DELETE FROM notes WHERE user_id = ? AND item_type = 'card' AND item_id = ?").run(uid, `U${id}`);
  return true;
})();

export const listUserCards = (uid: number) =>
  (db.prepare(`SELECT c.id, c.front, c.back, c.fact_id factId, c.path, c.created_at createdAt, s.due, s.card
               FROM user_cards c LEFT JOIN srs_cards s ON s.user_id = c.user_id AND s.fact_id = 'U' || c.id
               WHERE c.user_id = ? ORDER BY c.created_at DESC`).all(uid) as (Omit<UserCard, 'state'> & { card: string | null })[])
    .map(({ card, ...c }) => ({ ...c, state: card ? (JSON.parse(card).state as number) : null }));

// ---- library ----
export const ago = (t: number) => {
  const s = (now() - t) / 1000;
  return s < 60 ? 'just now' : s < 3600 ? `${Math.round(s / 60)} min ago` : s < 86_400 ? `${Math.round(s / 3600)} h ago` : s < 7 * 86_400 ? `${Math.round(s / 86_400)} d ago`
    : new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'short', year: s > 300 * 86_400 ? 'numeric' : undefined, timeZone: 'Asia/Karachi' });
};

const dec = (s: string) => { try { return decodeURIComponent(s); } catch { return s; } };
/** A readable title for a page path: the visit log first, then topic and fact pages. */
export function pageTitles(uid: number, paths: string[]) {
  const seen = new Map((db.prepare('SELECT ref, title FROM visits WHERE user_id = ?').all(uid) as { ref: string; title: string }[]).map((r) => [r.ref, r.title]));
  return new Map(paths.map((p) => {
    const [, a, b, c] = p.split('/');
    const t = seen.get(p) ?? (a === 'study' && c ? topicBySlug.get(c)?.title : a === 'facts' && b ? `Fact ${dec(b)}` : undefined);
    return [p, t ?? p];
  }));
}

export function libraryCounts(uid: number) {
  const n = (sql: string, ...a: unknown[]) => (db.prepare(sql).get(uid, ...a) as { n: number }).n;
  return {
    bookmarks: n("SELECT COUNT(*) n FROM marks WHERE user_id = ? AND kind = 'bookmark'"),
    weak: n("SELECT COUNT(*) n FROM marks WHERE user_id = ? AND kind = 'weak'"),
    collections: n('SELECT COUNT(*) n FROM collections WHERE user_id = ?'),
    notes: n('SELECT COUNT(*) n FROM notes WHERE user_id = ?'),
    highlights: n('SELECT COUNT(*) n FROM highlights WHERE user_id = ?'),
    cards: n('SELECT COUNT(*) n FROM user_cards WHERE user_id = ?'),
  };
}

export type HistoryEvent =
  | { kind: 'visit'; at: number; visitKind: string; ref: string; title: string }
  | { kind: 'mcq'; at: number; qid: string; choice: string; correct: number | null; source: string }
  | { kind: 'review'; at: number; factId: string; rating: number };

/** Recent visits, MCQ attempts and card reviews, newest first, grouped by Pakistan-time day. */
export function history(uid: number, days = 30, limit = 400) {
  const since = now() - days * 86_400_000;
  const ev: HistoryEvent[] = [
    ...(db.prepare('SELECT kind visitKind, ref, title, at FROM visits WHERE user_id = ? AND at > ? ORDER BY at DESC LIMIT ?').all(uid, since, limit) as any[]).map((r) => ({ kind: 'visit' as const, ...r })),
    ...(db.prepare('SELECT qid, choice, correct, source, created_at at FROM mcq_attempts WHERE user_id = ? AND created_at > ? ORDER BY created_at DESC LIMIT ?').all(uid, since, limit) as any[]).map((r) => ({ kind: 'mcq' as const, ...r })),
    ...(db.prepare('SELECT fact_id factId, rating, reviewed_at at FROM srs_log WHERE user_id = ? AND reviewed_at > ? ORDER BY reviewed_at DESC LIMIT ?').all(uid, since, limit) as any[]).map((r) => ({ kind: 'review' as const, ...r })),
  ].sort((a, b) => b.at - a.at).slice(0, limit);
  const out: { day: string; events: HistoryEvent[] }[] = [];
  for (const e of ev) {
    const d = dayKey(e.at);
    if (out.at(-1)?.day !== d) out.push({ day: d, events: [] });
    out.at(-1)!.events.push(e);
  }
  return out;
}
