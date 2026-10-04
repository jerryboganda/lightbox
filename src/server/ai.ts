import { createHash } from 'node:crypto';
import MiniSearch from 'minisearch';
import { audit, db, now } from './db';
import { notify } from './notify';
import { dayKey, text } from './personal';
import { factById, facts, isEditionClash, mcqs, SYSTEMS, topicBySlug, type Fact, type Topic } from '../lib/data';

// AI gateway (OpenCode Go, OpenAI-compatible): grounding on Lightbox facts, per-user daily caps, a global concurrency limit and a shared cache.
export type Kind = 'explain' | 'dispute' | 'tutor' | 'generate';
export interface Msg { role: 'system' | 'user' | 'assistant'; content: string }
export interface Quota { used: number; cap: number }
export interface Cite { id: string; fact: string; label: string }
export class AiError extends Error {
  constructor(public status: number, message: string, public quota?: Quota) { super(message); }
}

/** Tuning knobs; tests shrink the waits. */
export const AI = { concurrent: 2, queueMs: 8_000, queueMax: 8, idleMs: 45_000, history: 12, k: 10 };
export const MSG = { off: 'AI is not configured on this server.', unavailable: 'AI unavailable.', busy: 'AI is busy, try again shortly.', silent: 'AI did not answer.' };
const GO = 'https://opencode.ai/zen/go/v1';
const ZEN = 'https://opencode.ai/zen/v1/chat/completions';
const CACHED = new Set<Kind>(['explain', 'dispute']);

// Read per call so a deploy (or a test) can change them without a restart. The key never leaves this module.
const env = () => {
  const cap = Number.parseInt(process.env.AI_DAILY_CAP ?? '', 10);
  return {
    key: (process.env.OPENCODE_API_KEY ?? '').trim(),
    url: `${(process.env.AI_BASE_URL || GO).replace(/\/+$/, '')}/chat/completions`, // AI_BASE_URL: tests only
    model: process.env.AI_MODEL?.trim() || 'deepseek-v4-flash',
    fallback: process.env.AI_FALLBACK === 'zen' ? process.env.AI_FALLBACK_MODEL?.trim() || '' : '',
    cap: Number.isFinite(cap) && cap >= 0 ? cap : 30,
  };
};
export const aiEnabled = () => !!env().key;

// ---- quota ----
export function quota(uid: number): Quota {
  const r = db.prepare('SELECT u.role, COALESCE(a.n, 0) n FROM users u LEFT JOIN ai_usage a ON a.user_id = u.id AND a.day = ? WHERE u.id = ?').get(dayKey(now()), uid) as { role: string; n: number } | undefined;
  return { used: r?.n ?? 0, cap: env().cap * (r?.role === 'admin' ? 3 : 1) };
}
const charge = (uid: number, day: string, n: number, tokens = 0) =>
  db.prepare('INSERT INTO ai_usage (user_id, day, n, tokens) VALUES (?, ?, MAX(0, ?), ?) ON CONFLICT (user_id, day) DO UPDATE SET n = MAX(0, n + ?), tokens = tokens + excluded.tokens')
    .run(uid, day, n, tokens, n);

/** Throws unless AI is configured and the caller has requests left today. */
export function assertReady(uid: number) {
  if (!env().key) throw new AiError(503, MSG.off);
  const q = quota(uid);
  if (q.used >= q.cap) throw new AiError(429, `You have used all ${q.cap} of today's AI requests. They reset at midnight, Pakistan time.`, q);
  return q;
}

// ---- concurrency: two requests in flight for the whole server, one per user; others wait briefly ----
// ponytail: in-process limiter, like the login throttle; move to SQLite if the app ever runs several replicas.
let inFlight = 0;
const queue: (() => void)[] = [];
const busyUsers = new Set<number>();
function acquire() {
  if (inFlight < AI.concurrent) { inFlight++; return Promise.resolve(); }
  if (queue.length >= AI.queueMax) return Promise.reject(new AiError(429, MSG.busy));
  return new Promise<void>((res, rej) => {
    const go = () => { clearTimeout(t); res(); };
    const t = setTimeout(() => { const i = queue.indexOf(go); if (i >= 0) queue.splice(i, 1); rej(new AiError(429, MSG.busy)); }, AI.queueMs);
    queue.push(go);
  });
}
const release = () => { const next = queue.shift(); if (next) next(); else inFlight--; };

const statusError = (s: number) => (s === 429 ? new AiError(429, MSG.busy) : s >= 500 ? new AiError(502, MSG.silent) : new AiError(502, MSG.unavailable));
export const toAiError = (e: unknown) => (e instanceof AiError ? e : new AiError(504, MSG.silent));

/** The `data:` payloads of a server-sent event stream, whatever the chunking. */
export async function* sseData(body: ReadableStream<Uint8Array>) {
  const dec = new TextDecoder();
  let buf = '';
  for await (const chunk of body as unknown as AsyncIterable<Uint8Array>) {
    buf += dec.decode(chunk, { stream: true });
    const lines = buf.split(/\r?\n/);
    buf = lines.pop()!;
    for (const l of lines) if (l.startsWith('data:')) yield l.slice(5).trim();
  }
  if (buf.startsWith('data:')) yield buf.slice(5).trim();
}

export interface CallOpts { kind: Kind; userId: number; session: string; messages: Msg[]; stream?: boolean; maxTokens?: number; temperature?: number; signal?: AbortSignal; fresh?: boolean }
export interface CallResult { text: string; cached: boolean; tokens: number; quota: Quota }

/** Yields the answer as it arrives (whole when not streaming or cached) and returns the full result.
 *  Explain and dispute answers are cached for everyone; `fresh` regenerates. A request the AI never answered is not counted. */
export async function* callModel(o: CallOpts): AsyncGenerator<string, CallResult> {
  const c = env();
  if (!c.key) throw new AiError(503, MSG.off);
  const ck = CACHED.has(o.kind) ? createHash('sha256').update(`${o.kind}|${c.model}|${JSON.stringify(o.messages)}`).digest('hex') : null;
  if (ck && !o.fresh) {
    const hit = db.prepare('SELECT body FROM ai_cache WHERE key = ?').get(ck) as { body: string } | undefined;
    if (hit) {
      db.prepare('UPDATE ai_cache SET hits = hits + 1 WHERE key = ?').run(ck);
      yield hit.body;
      return { text: hit.body, cached: true, tokens: 0, quota: quota(o.userId) };
    }
  }
  assertReady(o.userId);
  if (busyUsers.has(o.userId)) throw new AiError(429, 'Wait for your current AI answer to finish.');
  busyUsers.add(o.userId);
  const day = dayKey(now());
  let out = '', tokens = 0, held = false, charged = false, timer: ReturnType<typeof setTimeout> | undefined;
  let idle = new AbortController();
  const bump = () => { clearTimeout(timer); timer = setTimeout(() => idle.abort(), AI.idleMs); };
  try {
    await acquire();
    held = true;
    charge(o.userId, day, 1);
    charged = true;
    let res: Response | undefined, model = c.model, err = new AiError(504, MSG.silent);
    // Fall back to paid Zen only when Go itself failed (5xx or no answer), never on auth or rate limits.
    for (const [url, m] of [[c.url, c.model], ...(c.fallback ? [[ZEN, c.fallback]] : [])]) {
      idle = new AbortController();
      bump();
      try {
        const r = await fetch(url, {
          method: 'POST',
          signal: o.signal ? AbortSignal.any([o.signal, idle.signal]) : idle.signal,
          headers: { authorization: `Bearer ${c.key}`, 'content-type': 'application/json', 'x-opencode-session': o.session, 'user-agent': 'lightbox-tutor/1.0' },
          body: JSON.stringify({ model: m, messages: o.messages, stream: !!o.stream, max_tokens: o.maxTokens ?? 800, temperature: o.temperature ?? 0.3 }),
        });
        if (r.ok) { res = r; model = m; break; }
        r.body?.cancel().catch(() => {});
        err = statusError(r.status);
        if (r.status < 500) break;
      } catch (e) {
        if (o.signal?.aborted) throw e;
        err = new AiError(504, MSG.silent);
      }
    }
    if (!res) throw err;
    if (o.stream && res.body) {
      for await (const data of sseData(res.body)) {
        bump();
        if (data === '[DONE]') break;
        let j: any;
        try { j = JSON.parse(data); } catch { continue; }
        if (j.error) throw new AiError(502, MSG.silent);
        if (j.usage?.total_tokens) tokens = j.usage.total_tokens;
        const d = j.choices?.[0]?.delta?.content;
        if (typeof d === 'string' && d) { out += d; yield d; }
      }
    } else {
      const j = (await res.json().catch(() => null)) as any;
      const t = j?.choices?.[0]?.message?.content;
      out = typeof t === 'string' ? t : '';
      tokens = j?.usage?.total_tokens ?? 0;
      if (out) yield out;
    }
    if (!out.trim()) throw new AiError(502, MSG.silent);
    if (ck) db.prepare('INSERT OR REPLACE INTO ai_cache (key, kind, model, body, created_at, hits) VALUES (?, ?, ?, ?, ?, 0)').run(ck, o.kind, model, out, now());
    return { text: out, cached: false, tokens, quota: quota(o.userId) };
  } catch (e) {
    if (charged && !out && !o.signal?.aborted) charge(o.userId, day, -1);
    throw o.signal?.aborted ? e : toAiError(e);
  } finally {
    clearTimeout(timer);
    if (held) release();
    busyUsers.delete(o.userId);
    if (tokens) charge(o.userId, day, 0, tokens);
  }
}

// ---- HTTP helpers ----
export const aiFail = (e: unknown) => {
  if (!(e instanceof AiError) && !(e instanceof Error && e.name === 'AbortError')) console.error('ai:', e);
  const x = toAiError(e);
  return Response.json({ error: x.message, quota: x.quota }, { status: x.status });
};
/** An AbortController that follows the client's request. */
export const follow = (signal: AbortSignal) => {
  const ac = new AbortController();
  signal.addEventListener('abort', () => ac.abort(), { once: true });
  return ac;
};

/** Streams a generator as server-sent events: {d} per chunk, then {done, ...result} or {error}.
 *  Errors before the first chunk (no key, cap, busy) become a JSON response with their status. */
export async function sse(gen: AsyncGenerator<string, object>, ac: AbortController, extra: object = {}): Promise<Response> {
  let r: IteratorResult<string, object>;
  try { r = await gen.next(); } catch (e) { return aiFail(e); }
  const enc = new TextEncoder();
  return new Response(new ReadableStream({
    async start(c) {
      const send = (o: object) => c.enqueue(enc.encode(`data: ${JSON.stringify(o)}\n\n`));
      try {
        while (!r.done) { send({ d: r.value }); r = await gen.next(); }
        send({ done: true, ...r.value, ...extra });
      } catch (e) {
        if (!ac.signal.aborted) try { send({ error: toAiError(e).message }); } catch {}
      } finally {
        await gen.return(undefined as never).catch(() => {});
        try { c.close(); } catch {}
      }
    },
    cancel() { ac.abort(); },
  }), { headers: { 'content-type': 'text/event-stream; charset=utf-8', 'cache-control': 'no-store', 'x-accel-buffering': 'no' } });
}

// ---- grounding ----
const STOP = new Set('a an and are as at be by can do does for from has have how i in is it its me of on or the their there these this to was what when where which who why will with you your about explain tell give list'.split(' '));
let index: MiniSearch | undefined;
const searchIndex = () => (index ??= (() => {
  const ms = new MiniSearch({
    fields: ['fact', 'topics', 'kind', 'system'],
    processTerm: (t) => { const w = t.toLowerCase(); return STOP.has(w) ? null : w; },
    searchOptions: { boost: { fact: 2, topics: 1.5 }, prefix: (t) => t.length > 3, fuzzy: (t) => (t.length > 4 ? 0.2 : false) },
  });
  ms.addAll(facts.map((f) => ({ id: f.id, fact: f.fact, topics: f.topics.map((s) => topicBySlug.get(s)?.title ?? '').join(' '), kind: f.kind, system: SYSTEMS[f.system]?.label ?? '' })));
  return ms;
})());
/** Top-k facts for a question. */
export const retrieve = (q: string, k = AI.k): Fact[] =>
  searchIndex().search(q.slice(0, 600)).slice(0, k).map((r) => factById.get(String(r.id))!).filter(Boolean);

export const topicFacts = (t: Topic) => [...new Set(t.sections.flatMap((s) => s.bullets.flatMap((b) => b.ids)))].map((id) => factById.get(id)!).filter(Boolean);
const STATUS: Record<string, string> = { cited: 'verified, cited', agreed: 'verified', unchecked: 'UNCHECKED, not verified', disputed: 'DISPUTED, sources disagree' };
export const factLine = (f: Fact) =>
  `[${f.id}] (${STATUS[f.label] ?? f.label}${isEditionClash(f) ? '; edition clash' : ''}; ${SYSTEMS[f.system]?.label ?? f.system}) ${f.fact}` +
  (f.paperDiffers ? `\n  The paper printed: ${f.paperDiffers}` : '') + (f.edition ? `\n  Edition: ${f.edition}` : '');

const ID_RE = /\bF-[A-Z]+-\d{3}[a-z]?\b/g;
/** Fact ids cited in an answer, keeping only real ids that were given to the model. */
export const citeIds = (answer: string, provided: Iterable<string>) => {
  const ok = new Set(provided);
  return [...new Set(answer.match(ID_RE) ?? [])].filter((id) => ok.has(id) && factById.has(id));
};
export const citeInfo = (ids: string[]): Cite[] => ids.flatMap((id) => { const f = factById.get(id); return f ? [{ id, fact: f.fact, label: f.label }] : []; });

const RULES = `You are Lightbox Tutor, an exam tutor for FCPS-II radiology candidates in Pakistan.
Use ONLY the Lightbox facts provided. Each fact starts with its id in square brackets, then its status.
- Cite the ids you rely on in square brackets right after the sentence, like [F-M-014]. Cite only ids from the provided facts.
- If the facts do not answer the question, say "Not covered in Lightbox notes yet." and suggest what to look up (a textbook chapter or guideline) instead of answering from memory.
- Never invent numbers, statistics, doses, criteria or references.
- When you use a fact marked UNCHECKED or DISPUTED, say so.
- Be concise and exam-focused. Plain text only: short paragraphs, "- " bullet lists and **bold** for key terms. No headings, tables, links or HTML.`;

// ---- explain this fact ----
export async function* explainFact(uid: number, factId: string, fresh = false, signal?: AbortSignal): AsyncGenerator<string, { cites: Cite[]; cached: boolean; quota: Quota }> {
  const f = factById.get(factId);
  if (!f) throw new AiError(404, 'Fact not found.');
  const near = [...facts.filter((x) => x !== f && x.topics.some((s) => f.topics.includes(s))), ...facts.filter((x) => x !== f && x.file === f.file && x.unit === f.unit)];
  const rel = [...new Set(near)].slice(0, 10);
  const messages: Msg[] = [
    { role: 'system', content: RULES },
    { role: 'user', content: `Fact to explain:\n${factLine(f)}\n\nOther Lightbox facts from the same topic or page:\n${rel.map(factLine).join('\n') || '(none)'}\n\n` +
      `Explain fact [${f.id}] to a candidate revising for the exam, in under 160 words, in exactly this shape:
**Why it matters:** one or two sentences.
**How it is examined:** one or two sentences on how MCQs or TOACS stations test it.
**Memory hook:** one short mnemonic or picture to remember it.
**Related:** up to three ids of the other facts above worth revising with it, each in square brackets, or "none".` },
  ];
  const r = yield* callModel({ kind: 'explain', userId: uid, session: `lightbox-u${uid}-explain`, messages, stream: true, maxTokens: 450, temperature: 0.2, fresh, signal });
  return { cites: citeInfo(citeIds(r.text, [f.id, ...rel.map((x) => x.id)])), cached: r.cached, quota: r.quota };
}

// ---- dispute summaries: only the item's recorded fields ----
const mcqById = new Map(mcqs.map((m) => [m.qid, m]));
const lines = (rows: [string, string | undefined][]) => rows.filter(([, v]) => v && v.trim()).map(([k, v]) => `${k}: ${v!.trim()}`).join('\n');
export function disputeRecord(type: unknown, id: unknown): string | null {
  if (typeof id !== 'string') return null;
  if (type === 'mcq') {
    const m = mcqById.get(id);
    if (!m || !['DISPUTED', 'KEY WRONG'].includes(m.verdict)) return null;
    return lines([['Question', m.stem], ['Options', Object.entries(m.options).map(([k, v]) => `${k}) ${v}`).join('; ')], ['Answer key in the paper', m.key],
      ['Key evidence', m.keyEvidence], ['Lightbox blind answer', m.myAnswer && `${m.myAnswer}${m.confidence ? ` (${m.confidence} confidence)` : ''}`],
      ['Reason for the blind answer', m.reason], ['Verdict', m.verdict], ['Evidence', m.evidence], ['Reviewer note', m.note]]);
  }
  if (type === 'fact') {
    const f = factById.get(id);
    if (!f || !(f.status === 'disputed' || f.paperDiffers || isEditionClash(f))) return null;
    return lines([['Fact', f.fact], ['Status', f.status], ['Source text', f.sourceText], ['Reviewer note', f.note], ['The paper printed', f.paperDiffers], ['Edition', f.edition]]);
  }
  return null;
}
const DISPUTE = `You summarise a disputed exam item for FCPS-II radiology candidates.
Use ONLY the record you are given. Do not add outside knowledge, numbers, guidelines or references that are not in it.
In under 150 words, in exactly this shape:
**Side 1:** one position and what in the record supports it.
**Side 2:** the other position and what in the record supports it.
**Why it is unresolved:** one or two sentences.
**For the exam:** only what the record itself advises; if it advises nothing, write "The record gives no advice."
Plain text only, no headings or links.`;

export async function* summariseDispute(uid: number, type: unknown, id: unknown, signal?: AbortSignal): AsyncGenerator<string, { cached: boolean; quota: Quota }> {
  const record = disputeRecord(type, id);
  if (!record) throw new AiError(404, 'That item has no recorded dispute.');
  const r = yield* callModel({ kind: 'dispute', userId: uid, session: `lightbox-u${uid}-dispute`, stream: true, maxTokens: 400, temperature: 0.1, signal,
    messages: [{ role: 'system', content: DISPUTE }, { role: 'user', content: `Record:\n${record}` }] });
  return { cached: r.cached, quota: r.quota };
}

// ---- tutor chats ----
export const CHAT = { title: 80, text: 2000, chats: 200, messages: 200 };
export interface Chat { id: number; title: string; context: string | null; createdAt: number; updatedAt: number }
export interface ChatMessage { id: number; role: 'user' | 'assistant'; content: string; cites: Cite[]; at: number }
const CHAT_COLS = 'id, title, context, created_at createdAt, updated_at updatedAt';
export const listChats = (uid: number) => db.prepare(`SELECT ${CHAT_COLS} FROM ai_chats WHERE user_id = ? ORDER BY updated_at DESC, id DESC LIMIT ${CHAT.chats}`).all(uid) as Chat[];
export const getChat = (uid: number, id: number) => db.prepare(`SELECT ${CHAT_COLS} FROM ai_chats WHERE id = ? AND user_id = ?`).get(id, uid) as Chat | undefined;
export const chatTopic = (c: Pick<Chat, 'context'>) => (c.context?.startsWith('topic:') ? topicBySlug.get(c.context.slice(6)) : undefined);

export function createChat(uid: number, title: unknown, topic: unknown) {
  const t = topic === undefined || topic === null || topic === '' ? null : typeof topic === 'string' ? topicBySlug.get(topic) : undefined;
  if (t === undefined) return { error: 'Unknown topic.' } as const;
  const name = title === undefined || title === '' ? (t?.title ?? 'New chat') : text(typeof title === 'string' ? title.trim().slice(0, CHAT.title) : title, CHAT.title);
  if (!name) return { error: 'Chat titles can be up to 80 characters.' } as const;
  if ((db.prepare('SELECT COUNT(*) n FROM ai_chats WHERE user_id = ?').get(uid) as { n: number }).n >= CHAT.chats) return { error: 'You have 200 chats. Delete some old ones first.' } as const;
  const ts = now();
  return { id: Number(db.prepare('INSERT INTO ai_chats (user_id, title, context, created_at, updated_at) VALUES (?, ?, ?, ?, ?)').run(uid, name, t ? `topic:${t.slug}` : null, ts, ts).lastInsertRowid) } as const;
}
export function renameChat(uid: number, id: number, title: unknown) {
  const name = text(title, CHAT.title);
  return !!name && db.prepare('UPDATE ai_chats SET title = ? WHERE id = ? AND user_id = ?').run(name, id, uid).changes > 0;
}
export const deleteChat = (uid: number, id: number) => db.prepare('DELETE FROM ai_chats WHERE id = ? AND user_id = ?').run(id, uid).changes > 0;
const parseIds = (s: string) => { try { const a = JSON.parse(s); return Array.isArray(a) ? a.filter((x): x is string => typeof x === 'string') : []; } catch { return []; } };
export function chatMessages(uid: number, id: number): ChatMessage[] | null {
  if (!getChat(uid, id)) return null;
  return (db.prepare('SELECT id, role, content, cites, created_at at FROM ai_messages WHERE chat_id = ? ORDER BY id').all(id) as { id: number; role: 'user' | 'assistant'; content: string; cites: string; at: number }[])
    .map((m) => ({ ...m, cites: citeInfo(parseIds(m.cites)) }));
}

/** Streams the tutor's answer to a new question, or answers the last question again (`retry`). Saves both turns; a stopped answer keeps what was shown. */
export async function* tutorReply(uid: number, chatId: number, input: { text?: unknown; retry?: unknown }, signal?: AbortSignal): AsyncGenerator<string, { id: number; cites: Cite[]; quota: Quota }> {
  const chat = getChat(uid, chatId);
  if (!chat) throw new AiError(404, 'Chat not found.');
  // The question is saved before any AI check, so { retry: true } can always answer it later (after a cap, outage or stop).
  const last = db.prepare('SELECT id, role FROM ai_messages WHERE chat_id = ? ORDER BY id DESC LIMIT 1').get(chatId) as { id: number; role: string } | undefined;
  if (input.retry === true) {
    if (!last) throw new AiError(400, 'There is nothing to answer yet.');
    if (last.role === 'assistant') db.prepare('DELETE FROM ai_messages WHERE id = ?').run(last.id);
  } else {
    const q = text(input.text, CHAT.text);
    if (!q) throw new AiError(400, `Write a question of up to ${CHAT.text} characters.`);
    if ((db.prepare('SELECT COUNT(*) n FROM ai_messages WHERE chat_id = ?').get(chatId) as { n: number }).n >= CHAT.messages) throw new AiError(400, 'This chat is full. Start a new one.');
    db.prepare("INSERT INTO ai_messages (chat_id, role, content, created_at) VALUES (?, 'user', ?, ?)").run(chatId, q, now());
  }
  const turns = (db.prepare('SELECT role, content FROM ai_messages WHERE chat_id = ? ORDER BY id DESC LIMIT ?').all(chatId, AI.history + 1) as Msg[]).reverse();
  const question = turns.pop();
  if (question?.role !== 'user') throw new AiError(400, 'There is nothing to answer yet.');
  const topic = chatTopic(chat);
  const prev = [...turns].reverse().find((m) => m.role === 'user')?.content ?? '';
  const pool = new Map<string, Fact>();
  for (const f of topic ? topicFacts(topic).slice(0, 14) : []) pool.set(f.id, f);
  for (const f of retrieve(`${question.content} ${prev}`, AI.k)) if (pool.size < 22) pool.set(f.id, f);
  const messages: Msg[] = [
    { role: 'system', content: RULES + (topic ? `\nThis chat is about the Lightbox topic "${topic.title}".` : '') },
    ...turns,
    { role: 'user', content: `Lightbox facts for this question:\n${[...pool.values()].map(factLine).join('\n') || '(none found)'}\n\nQuestion: ${question.content}` },
  ];
  const save = (body: string) => {
    const ids = citeIds(body, pool.keys());
    db.prepare('UPDATE ai_chats SET updated_at = ? WHERE id = ?').run(now(), chatId);
    return { id: Number(db.prepare("INSERT INTO ai_messages (chat_id, role, content, cites, created_at) VALUES (?, 'assistant', ?, ?, ?)").run(chatId, body, JSON.stringify(ids), now()).lastInsertRowid), cites: citeInfo(ids) };
  };
  const it = callModel({ kind: 'tutor', userId: uid, session: `lightbox-u${uid}-c${chatId}`, messages, stream: true, maxTokens: 900, temperature: 0.3, signal });
  let answer = '', saved = false;
  try {
    let r = await it.next();
    while (!r.done) { answer += r.value; yield r.value; r = await it.next(); }
    saved = true;
    return { ...save(answer), quota: r.value.quota };
  } finally {
    await it.return(undefined as never); // frees the gateway slot if the student pressed stop
    if (!saved && answer.trim()) save(`${answer.trimEnd()} …`);
  }
}

// ---- generated MCQs ----
export interface GenMcq { stem: string; options: Record<string, string>; key: string; explanation: string; fact_ids: string[] }
const LETTERS = ['A', 'B', 'C', 'D', 'E'];
const clean = (v: unknown) => (typeof v === 'string' ? v.replace(/\s+/g, ' ').trim() : typeof v === 'number' ? String(v) : '');

/** One generated question, repaired where the intent is clear (array options, "A) " prefixes, key given as text,
 *  ids only in the explanation), else null. Ids must be among the facts the model was given. */
export function validateMcq(raw: unknown, allowed: Set<string>): GenMcq | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null;
  const r = raw as Record<string, unknown>;
  const stem = clean(r.stem ?? r.question);
  if (stem.length < 15 || stem.length > 700) return null;
  const entries: [string, unknown][] = Array.isArray(r.options) ? r.options.map((v, i) => [LETTERS[i] ?? '?', v])
    : r.options && typeof r.options === 'object' ? Object.entries(r.options).sort(([a], [b]) => a.localeCompare(b)) : [];
  if (entries.length < 4 || entries.length > 5) return null;
  const options: Record<string, string> = {}, relabel = new Map<string, string>();
  for (const [i, [k, v]] of entries.entries()) {
    const t = clean(v).replace(/^\(?[A-Ea-e][).:]\s+/, '');
    if (!t || t.length > 250 || /\b(all|none) of the above\b/i.test(t)) return null;
    options[LETTERS[i]] = t;
    relabel.set(clean(k).toUpperCase().replace(/[^A-Z]/g, ''), LETTERS[i]);
  }
  if (new Set(Object.values(options).map((t) => t.toLowerCase())).size !== entries.length) return null;
  const k = clean(r.key ?? r.answer);
  const letter = k.toUpperCase().match(/^\(?([A-E])(?:$|[).:\s])/)?.[1];
  const key = (letter && (relabel.get(letter) ?? letter)) || Object.keys(options).find((l) => options[l].toLowerCase() === k.replace(/^\(?[A-Ea-e][).:]\s+/, '').toLowerCase());
  if (!key || !(key in options)) return null;
  const explanation = clean(r.explanation ?? r.rationale);
  if (!explanation || explanation.length > 900) return null;
  const given = Array.isArray(r.fact_ids ?? r.factIds) ? ((r.fact_ids ?? r.factIds) as unknown[]).map(clean) : [];
  const ids = [...new Set([...given, ...(explanation.match(ID_RE) ?? [])])].filter((id) => allowed.has(id));
  return ids.length ? { stem, options, key, explanation, fact_ids: ids } : null;
}

/** Valid questions from the model's JSON, tolerating code fences and prose around it. */
export function parseMcqs(answer: string, allowed: Set<string>) {
  const s = answer.replace(/```(?:json)?/gi, '').trim();
  let j: unknown = null;
  for (const c of [s, s.slice(s.indexOf('{'), s.lastIndexOf('}') + 1), s.slice(s.indexOf('['), s.lastIndexOf(']') + 1)]) {
    try { j = JSON.parse(c); break; } catch {}
  }
  const o = j as Record<string, unknown> | null;
  const list: unknown[] = Array.isArray(j) ? j : Array.isArray(o?.mcqs) ? (o!.mcqs as unknown[]) : Array.isArray(o?.questions) ? (o!.questions as unknown[]) : o && typeof o === 'object' && 'stem' in o ? [o] : [];
  const items = list.map((x) => validateMcq(x, allowed)).filter((x): x is GenMcq => !!x);
  return { items, rejected: list.length - items.length };
}

export const MAX_PENDING = 30;
export async function generateMcqs(uid: number, o: { topicSlug?: unknown; factIds?: unknown; n?: unknown }, signal?: AbortSignal) {
  const n = o.n;
  if (typeof n !== 'number' || !Number.isInteger(n) || n < 1 || n > 5) throw new AiError(400, 'Ask for 1 to 5 questions.');
  const t = typeof o.topicSlug === 'string' ? topicBySlug.get(o.topicSlug) : undefined;
  if (o.topicSlug !== undefined && !t) throw new AiError(400, 'Unknown topic.');
  const ids = t ? topicFacts(t).map((f) => f.id) : Array.isArray(o.factIds) && o.factIds.length <= 40 ? o.factIds.filter((x): x is string => typeof x === 'string') : [];
  const src = ids.map((id) => factById.get(id)).filter((f): f is Fact => !!f && f.status === 'verified').slice(0, 24);
  if (!src.length) throw new AiError(400, 'There are no verified facts here to write questions from.');
  if ((db.prepare("SELECT COUNT(*) n FROM ai_mcqs WHERE created_by = ? AND status = 'pending'").get(uid) as { n: number }).n >= MAX_PENDING)
    throw new AiError(429, `You have ${MAX_PENDING} questions waiting for review. Generate more once an admin has reviewed them.`);
  const messages: Msg[] = [
    { role: 'system', content: 'You write single-best-answer MCQs for the FCPS-II radiology exam. You reply with JSON only.' },
    { role: 'user', content: `Verified Lightbox facts:\n${src.map(factLine).join('\n')}\n\n` +
      `Write ${n} single-best-answer MCQ${n === 1 ? '' : 's'} using ONLY these facts.
- Each question tests one or two facts; the key must be fully supported by them. No outside knowledge.
- 4 or 5 options labelled A to E with one correct answer and plausible distractors. No "all of the above" or "none of the above".
- explanation: one to three sentences on why the key is right, citing fact ids in square brackets.
- fact_ids: the ids the question is based on.
Reply with JSON only, no prose and no code fences, in this shape:
{"mcqs":[{"stem":"...","options":{"A":"...","B":"...","C":"...","D":"..."},"key":"B","explanation":"... [F-M-001]","fact_ids":["F-M-001"]}]}` },
  ];
  let answer = '';
  for await (const d of callModel({ kind: 'generate', userId: uid, session: `lightbox-u${uid}-generate`, messages, stream: true, maxTokens: 400 + n * 450, temperature: 0.5, signal })) answer += d;
  const { items, rejected } = parseMcqs(answer, new Set(src.map((f) => f.id)));
  const keep = items.slice(0, n);
  if (!keep.length) throw new AiError(502, 'The AI did not return usable questions. Try again.');
  const ins = db.prepare('INSERT INTO ai_mcqs (created_by, topic_slug, fact_ids, stem, options, key, explanation, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)');
  const saved = db.transaction(() => keep.map((q) => ({ id: Number(ins.run(uid, t?.slug ?? null, JSON.stringify(q.fact_ids), q.stem, JSON.stringify(q.options), q.key, q.explanation, now()).lastInsertRowid), ...q })))();
  notify('admins', { kind: 'ai-mcq', title: `${saved.length} AI MCQ${saved.length === 1 ? '' : 's'} await review`, body: t ? `From ${t.title}` : '', href: '/admin?tab=ai' }, uid);
  audit(uid, 'ai.generate', `${saved.length} pending${t ? ` · ${t.slug}` : ''}`);
  return { items: saved.map((q) => ({ ...q, facts: citeInfo(q.fact_ids) })), rejected: rejected + items.length - keep.length, quota: quota(uid) };
}

// ---- approved AI MCQ bank ----
export interface BankMcq { id: number; stem: string; options: Record<string, string>; key: string; explanation: string; topic: { slug: string; title: string; href: string } | null; system: string; facts: Cite[] }
export function approvedMcqs(): BankMcq[] {
  const rows = db.prepare("SELECT id, topic_slug, fact_ids, stem, options, key, explanation FROM ai_mcqs WHERE status = 'approved' ORDER BY id").all() as { id: number; topic_slug: string | null; fact_ids: string; stem: string; options: string; key: string; explanation: string }[];
  return rows.flatMap((r) => {
    let options: Record<string, string>;
    try { options = JSON.parse(r.options); } catch { return []; }
    if (!options || typeof options !== 'object' || !(r.key in options)) return [];
    const t = r.topic_slug ? topicBySlug.get(r.topic_slug) : undefined;
    const fs = citeInfo(parseIds(r.fact_ids));
    return [{ id: r.id, stem: r.stem, options, key: r.key, explanation: r.explanation, topic: t ? { slug: t.slug, title: t.title, href: `/study/${t.system}/${t.slug}` } : null, system: t?.system ?? factById.get(fs[0]?.id ?? '')?.system ?? 'other', facts: fs }];
  });
}
export const pendingCount = (uid: number) => (db.prepare("SELECT COUNT(*) n FROM ai_mcqs WHERE created_by = ? AND status = 'pending'").get(uid) as { n: number }).n;
export const approvedCount = () => (db.prepare("SELECT COUNT(*) n FROM ai_mcqs WHERE status = 'approved'").get() as { n: number }).n;
