// Exports: flashcard scopes as an Anki package or CSV, and the caller's own data as JSON. Every query is scoped to the caller.
import { db } from './db';
import { buildApkg, type AnkiNote } from './anki';
import { dayKey, getCollection, intId, type Item } from './personal';
import { unitWord } from '../lib/sources';
import { cardByFact, cards, factById, isEditionClash, LABELS, shortFile, SYSTEMS, topicBySlug, type Fact } from '../lib/data';

export const SITE = 'https://lightbox.polytronx.com';
export interface Scope { scope: string; label: string; count: number }
/** One exported card as plain text. `where` is the source file and page; `urls` the cited web sources. */
export interface ExportCard { guid: string; front: string; back: string; factId: string | null; where: string; urls: string[]; status: string; fact: string; tags: string[] }

const OWN = /^U[1-9]\d{0,12}$/;
const bySystem = new Map<string, string[]>();
for (const c of cards) { const s = factById.get(c.factId)?.system ?? 'other'; bySystem.set(s, [...(bySystem.get(s) ?? []), c.factId]); }
const topicFacts = (slug: string) => topicBySlug.get(slug)?.sections.flatMap((s) => s.bullets.flatMap((b) => b.ids)) ?? [];
// Collections hold facts and topics; a topic contributes the facts it cites.
const itemFacts = (items: Item[]) => items.flatMap((it) => (it.type === 'fact' ? [it.id] : it.type === 'topic' ? topicFacts(it.id) : []));
// Facts that have a verified card, plus own cards ('U<id>'), deduplicated in order.
const usable = (ids: string[]) => [...new Set(ids)].filter((id) => cardByFact.has(id) || OWN.test(id));
const ownCards = (uid: number) => db.prepare('SELECT id, front, back, fact_id factId FROM user_cards WHERE user_id = ? ORDER BY created_at, id').all(uid) as { id: number; front: string; back: string; factId: string | null }[];

/** The cards in an export scope (all | system:<key> | bookmarks | weak | mine | collection:<id>), or null when unknown or not visible to the caller. */
export function resolveScope(uid: number, scope: unknown): { scope: string; label: string; refs: string[] } | null {
  if (typeof scope !== 'string' || scope.length > 40) return null;
  if (scope === 'all') return { scope, label: 'All verified cards', refs: cards.map((c) => c.factId) };
  if (scope === 'mine') return { scope, label: 'My cards', refs: ownCards(uid).map((c) => `U${c.id}`) };
  if (scope === 'bookmarks' || scope === 'weak') {
    const ids = db.prepare("SELECT item_id id FROM marks WHERE user_id = ? AND kind = ? AND item_type IN ('fact', 'card') ORDER BY created_at, rowid")
      .all(uid, scope === 'weak' ? 'weak' : 'bookmark') as { id: string }[];
    return { scope, label: scope === 'weak' ? 'My weak spots' : 'My bookmarks', refs: usable(ids.map((r) => r.id)) };
  }
  const [kind, key = '', extra] = scope.split(':');
  if (extra !== undefined) return null; // the scope is echoed into the filename, so only canonical forms pass
  if (kind === 'system' && bySystem.has(key)) return { scope, label: SYSTEMS[key]?.label ?? key, refs: bySystem.get(key)! };
  if (kind === 'collection' && String(intId(key)) === key) { const c = getCollection(uid, intId(key)); return c && { scope, label: c.name, refs: usable(itemFacts(c.items)) }; }
  return null;
}

/** One scope with its card count, for a page that offers just that deck. */
export const scopeInfo = (uid: number, scope: string): Scope | null => { const r = resolveScope(uid, scope); return r && { scope: r.scope, label: r.label, count: r.refs.length }; };

/** Every scope the caller can export, with card counts: all, each system, marks, own cards and own collections. */
export function exportScopes(uid: number): Scope[] {
  const n = (s: string) => resolveScope(uid, s)!.refs.length;
  const rows = db.prepare(`SELECT c.id, c.name, i.item_type type, i.item_id itemId FROM collections c LEFT JOIN collection_items i ON i.collection_id = c.id
                           WHERE c.user_id = ? ORDER BY c.updated_at DESC, c.id, i.position, i.added_at`).all(uid) as { id: number; name: string; type: string | null; itemId: string | null }[];
  const cols = new Map<number, { name: string; items: Item[] }>();
  for (const r of rows) {
    const c = cols.get(r.id) ?? cols.set(r.id, { name: r.name, items: [] }).get(r.id)!;
    if (r.type && r.itemId) c.items.push({ type: r.type as Item['type'], id: r.itemId });
  }
  return [
    { scope: 'all', label: 'All verified cards', count: cards.length },
    ...Object.keys(SYSTEMS).filter((s) => bySystem.has(s)).map((s) => ({ scope: `system:${s}`, label: SYSTEMS[s].label, count: bySystem.get(s)!.length })),
    { scope: 'bookmarks', label: 'My bookmarks', count: n('bookmarks') },
    { scope: 'weak', label: 'My weak spots', count: n('weak') },
    { scope: 'mine', label: 'My cards', count: n('mine') },
    ...[...cols].map(([id, c]) => ({ scope: `collection:${id}`, label: c.name, count: usable(itemFacts(c.items)).length })),
  ];
}

const place = (f: Fact) => `${shortFile(f.file)}, ${unitWord(f.file).toLowerCase()} ${f.unit}`;
const statusText = (f: Fact) => `${LABELS[f.label].text}: ${LABELS[f.label].hint.toLowerCase()}${isEditionClash(f) ? `. ${LABELS.edition.text}: ${LABELS.edition.hint.toLowerCase()}` : ''}`;
const isUrl = (u: string) => /^https?:\/\/[^\s"'<>]+$/.test(u);

/** Card content for a list of refs. Own cards resolve only for their owner and are labelled as unverified. */
export function exportCards(uid: number, refs: string[]): ExportCard[] {
  const own = new Map(refs.some((r) => OWN.test(r)) ? ownCards(uid).map((c) => [`U${c.id}`, c]) : []);
  return refs.flatMap((ref): ExportCard[] => {
    const u = own.get(ref);
    if (u) {
      const f = u.factId ? factById.get(u.factId) : undefined;
      return [{ guid: `lightbox:${ref}`, front: u.front, back: u.back, factId: f?.id ?? null, where: f ? place(f) : '', urls: [], status: 'Your own card: not verified by Lightbox', fact: f?.fact ?? '', tags: ['lightbox', f?.system ?? 'mine', 'own-card'] }];
    }
    const c = cardByFact.get(ref), f = factById.get(ref);
    if (!c || !f) return [];
    return [{
      guid: `lightbox:${f.id}`, front: c.front, back: c.back, factId: f.id, where: place(f), urls: f.sources.filter(isUrl), status: statusText(f), fact: f.fact,
      tags: ['lightbox', f.system, f.label, ...(isEditionClash(f) ? ['edition-clash'] : [])],
    }];
  });
}

const esc = (s: string) => s.replace(/[&<>"']/g, (ch) => `&#${ch.charCodeAt(0)};`).replace(/\r?\n/g, '<br>');
const link = (href: string, text: string) => `<a href="${esc(href)}">${esc(text)}</a>`;
const pretty = (u: string) => u.replace(/^https?:\/\/(www\.)?/, '').replace(/\/$/, '');

export function toAnkiNote(c: ExportCard): AnkiNote {
  const source = [c.factId && link(`${SITE}/facts/${encodeURIComponent(c.factId)}`, c.factId), c.where && esc(c.where), ...c.urls.map((u) => link(u, pretty(u)))].filter(Boolean).join(' · ');
  // Anki's sort field is the field text with tags stripped; our only tag is the <br> from newlines.
  return { guid: c.guid, sort: c.front.replace(/\r?\n/g, ''), tags: c.tags, fields: [esc(c.front), esc(c.back), source, esc(c.status), esc(c.fact)] };
}

export const deckName = (label: string) => `Lightbox::${label.replace(/::+/g, ':').trim() || 'Cards'}`;
export const fileStem = (scope: string) => `lightbox-${scope.replace(':', '-')}`;

export function ankiPackage(label: string, list: ExportCard[], t = Date.now()) {
  const date = new Date(t).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'Asia/Karachi' });
  const desc = `Exported from Lightbox on ${date}: ${list.length} card${list.length === 1 ? '' : 's'}. Under each answer, Status says how the card was checked and Source says where. Importing a newer export updates these cards instead of duplicating them.`;
  return buildApkg(deckName(label), desc, list.map(toAnkiNote), t);
}

// Quoted cells; a leading = + - @ is defused so spreadsheets never run it as a formula.
const cell = (s: string) => `"${(/^[=+\-@\t\r]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"`;
/** UTF-8 CSV with a byte-order mark so Excel reads the accents and symbols correctly. */
export const toCsv = (list: ExportCard[]) =>
  '﻿' + [['Front', 'Back', 'Source', 'Status', 'Fact'], ...list.map((c) => [c.front, c.back, [c.factId ?? '', c.where, ...c.urls].filter(Boolean).join(' · '), c.status, c.fact])]
    .map((r) => r.map(cell).join(',')).join('\r\n') + '\r\n';

export const download = (body: BodyInit, filename: string, type: string) =>
  new Response(body, { headers: { 'content-type': type, 'content-disposition': `attachment; filename="${filename}"`, 'cache-control': 'no-store' } });

/** Everything the caller has made or done in Lightbox. No password hash, sessions or other people's data. */
export function myData(uid: number) {
  const all = <T = Record<string, unknown>>(sql: string) => db.prepare(sql).all(uid) as T[];
  const cols = all<{ id: number; name: string; description: string; shared: number; createdAt: number; updatedAt: number }>(
    'SELECT id, name, description, shared, created_at createdAt, updated_at updatedAt FROM collections WHERE user_id = ? ORDER BY created_at, id');
  const colItems = all<{ cid: number; type: string; id: string; addedAt: number }>(
    'SELECT i.collection_id cid, i.item_type type, i.item_id id, i.added_at addedAt FROM collection_items i JOIN collections c ON c.id = i.collection_id WHERE c.user_id = ? ORDER BY i.position, i.added_at');
  const exams = all<{ id: number; config: string; items: string }>(
    'SELECT id, mode, title, config, items, time_limit timeLimit, started_at startedAt, finished_at finishedAt, score, total FROM exams WHERE user_id = ? ORDER BY started_at, id');
  const answers = all<{ examId: number }>(
    'SELECT a.exam_id examId, a.item_id itemId, a.choice, a.correct, a.flagged, a.ms, a.answered_at answeredAt FROM exam_answers a JOIN exams e ON e.id = a.exam_id WHERE e.user_id = ? ORDER BY a.exam_id, a.answered_at');
  const chats = all<{ id: number }>('SELECT id, title, context, created_at createdAt, updated_at updatedAt FROM ai_chats WHERE user_id = ? ORDER BY created_at, id');
  const messages = all<{ chatId: number }>(
    'SELECT m.chat_id chatId, m.role, m.content, m.cites, m.created_at createdAt FROM ai_messages m JOIN ai_chats c ON c.id = m.chat_id WHERE c.user_id = ? ORDER BY m.chat_id, m.id');
  const group = <T extends Record<K, number>, K extends string>(rows: T[], k: K) => rows.reduce((m, r) => m.set(r[k], [...(m.get(r[k]) ?? []), r]), new Map<number, T[]>());
  const itemsBy = group(colItems, 'cid'), answersBy = group(answers, 'examId'), messagesBy = group(messages, 'chatId');
  return {
    app: 'Lightbox', exportedAt: new Date().toISOString(), times: 'Unix epoch milliseconds (UTC)',
    profile: db.prepare('SELECT username, display_name displayName, role, created_at createdAt, last_seen_at lastSeenAt FROM users WHERE id = ?').get(uid),
    goals: db.prepare('SELECT cards, mcqs, minutes, exam_date examDate, updated_at updatedAt FROM goals WHERE user_id = ?').get(uid) ?? null,
    marks: all('SELECT item_type type, item_id id, kind, created_at createdAt FROM marks WHERE user_id = ? ORDER BY created_at, rowid'),
    collections: cols.map((c) => ({ ...c, shared: !!c.shared, items: (itemsBy.get(c.id) ?? []).map(({ cid: _, ...i }) => i) })),
    notes: all('SELECT item_type type, item_id id, body, created_at createdAt, updated_at updatedAt FROM notes WHERE user_id = ? ORDER BY created_at, id'),
    highlights: all('SELECT path, quote, prefix, suffix, color, note, fact_id factId, created_at createdAt FROM highlights WHERE user_id = ? ORDER BY created_at, id'),
    cards: all('SELECT id, front, back, fact_id factId, path, created_at createdAt FROM user_cards WHERE user_id = ? ORDER BY created_at, id'),
    flashcardReviews: all('SELECT fact_id factId, rating, reviewed_at reviewedAt FROM srs_log WHERE user_id = ? ORDER BY reviewed_at, id'),
    mcqAttempts: all('SELECT qid, choice, correct, ms, source, created_at createdAt FROM mcq_attempts WHERE user_id = ? ORDER BY created_at, id'),
    exams: exams.map((e) => ({ ...e, config: JSON.parse(e.config), items: JSON.parse(e.items), answers: (answersBy.get(e.id) ?? []).map(({ examId: _, ...a }) => a) })),
    studySessions: all('SELECT kind, started_at startedAt, seconds FROM study_sessions WHERE user_id = ? ORDER BY started_at, id'),
    comments: all('SELECT id, item_type itemType, item_id itemId, parent_id parentId, body, created_at createdAt, edited_at editedAt, hidden FROM comments WHERE user_id = ? AND deleted = 0 ORDER BY created_at, id'),
    votes: all('SELECT item_type type, item_id id, created_at createdAt FROM votes WHERE user_id = ? ORDER BY created_at'),
    reports: all('SELECT item_type type, item_id id, kind, body, quote, path, status, resolution, created_at createdAt, resolved_at resolvedAt FROM reports WHERE user_id = ? ORDER BY created_at, id'),
    pollVotes: all('SELECT poll_id pollId, choice, created_at createdAt FROM poll_votes WHERE user_id = ? ORDER BY created_at'),
    aiChats: chats.map((c) => ({ ...c, messages: (messagesBy.get(c.id) ?? []).map(({ chatId: _, ...m }) => m) })),
  };
}

export const myDataFile = (username: string) => `lightbox-${username.toLowerCase().replace(/[^a-z0-9._-]/g, '')}-${dayKey(Date.now())}.json`;
