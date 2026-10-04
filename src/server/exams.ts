import { randomInt } from 'node:crypto';
import { db, now } from './db';
import { recordAttempt } from './progress';
import { facts, images, mcqs, shortFile, SYSTEMS, type Fact, type Mcq } from '../lib/data';
import { HISTORIES, matcher, PAPERS, STATUSES, type Filters, type Mine, type PoolItem } from '../lib/quiz';

export type Mode = 'quiz' | 'exam' | 'toacs';
export type Grade = 'got' | 'partial' | 'missed';
export interface Item { q: string; o?: string } // q: MCQ qid or atlas image file; o: shuffled option letters
export interface ExamRow { id: number; user_id: number; mode: Mode; title: string; config: string; items: string; time_limit: number | null; started_at: number; finished_at: number | null; score: number | null; total: number | null }
export interface AnswerRow { item_id: string; choice: string | null; correct: number | null; flagged: number; ms: number; answered_at: number | null }

const GRACE = 5000; // network slack after the deadline
export const GRADES: Grade[] = ['got', 'partial', 'missed'];
export const TOACS_SECONDS = [30, 60, 90, 120];
const MAX_ITEM_MS = 600_000;

// ---- question pool -------------------------------------------------------
const norm = (s: string) => s.replace(/__u\d+\.txt$/, '').replace(/\.(pdf|docx|pptx?)$/i, '').toLowerCase().replace(/[^a-z0-9]/g, '');
const words = (s: string) => new Set(s.toLowerCase().match(/[a-z]{4,}/g) || []);
const factsOnPage = new Map<string, Fact[]>();
for (const f of facts) { const k = `${norm(f.file)}|${f.unit}`; factsOnPage.set(k, [...(factsOnPage.get(k) ?? []), f]); }

// MCQs carry no system: borrow it from the fact on the same paper page whose wording overlaps most, else the page majority.
function deriveSystem(q: Mcq) {
  const cand = factsOnPage.get(`${norm(q.file)}|${q.unit}`) ?? [];
  if (!cand.length) return 'other';
  const w = words(q.stem + ' ' + Object.values(q.options).join(' '));
  let best = '', top = 0;
  for (const f of cand) { let s = 0; for (const t of words(f.fact)) if (w.has(t)) s++; if (s > top) { top = s; best = f.system; } }
  if (best) return best;
  const tally = new Map<string, number>();
  for (const f of cand) tally.set(f.system, (tally.get(f.system) ?? 0) + 1);
  return [...tally].sort((a, b) => b[1] - a[1])[0][0];
}

const usable = mcqs.filter((m) => Object.keys(m.options).length >= 2);
export const mcqByQid = new Map(usable.map((m) => [m.qid, m]));
export const pool: PoolItem[] = usable.map((m) => ({ qid: m.qid, paper: m.paper, system: deriveSystem(m), keyed: !!m.key, disputed: m.verdict === 'DISPUTED', notBlind: m.notBlind }));
const poolByQid = new Map(pool.map((p) => [p.qid, p]));

export function mine(userId: number): Mine {
  const latest = db.prepare(`SELECT qid, correct FROM mcq_attempts a WHERE user_id = ?
                             AND id = (SELECT MAX(id) FROM mcq_attempts b WHERE b.user_id = a.user_id AND b.qid = a.qid)`).all(userId) as { qid: string; correct: number | null }[];
  const marked = db.prepare(`SELECT DISTINCT item_id FROM marks WHERE user_id = ? AND item_type = 'mcq'`).all(userId) as { item_id: string }[];
  return { answered: latest.map((r) => r.qid), wrong: latest.filter((r) => r.correct === 0).map((r) => r.qid), marked: marked.map((r) => r.item_id) };
}

// ---- creation -----------------------------------------------------------
export interface Build { mode: 'quiz' | 'exam'; filters: Filters; count: number; shuffle: boolean; shuffleOptions: boolean; perQuestion: number; totalSeconds: number; title: string }

const strs = (v: unknown, allowed: string[]) => (Array.isArray(v) ? [...new Set(v.filter((x): x is string => typeof x === 'string' && allowed.includes(x)))] : []);
const int = (v: unknown, lo: number, hi: number) => { const n = Math.round(Number(v)); return Number.isFinite(n) && n >= lo && n <= hi ? n : null; };

// Untrusted JSON from the builder -> a validated build, or an error message.
export function parseBuild(b: any): Build | string {
  if (!b || typeof b !== 'object') return 'Send a quiz configuration.';
  if (b.mode !== 'quiz' && b.mode !== 'exam') return 'Choose practice or exam mode.';
  const f = b.filters ?? {};
  const history = f.history === 'weak' || HISTORIES.some(([h]) => h === f.history) ? f.history : 'any';
  const count = int(b.count, 1, 200);
  if (count === null) return 'Choose between 1 and 200 questions.';
  let perQuestion = 0, totalSeconds = 0;
  if (b.mode === 'exam') {
    const per = int(b.perQuestion, 15, 600), total = int(b.totalMinutes, 1, 360);
    if (b.timing === 'total') { if (total === null) return 'Total time must be 1 to 360 minutes.'; totalSeconds = total * 60; }
    else { if (per === null) return 'Time per question must be 15 to 600 seconds.'; perQuestion = per; }
  }
  const title = typeof b.title === 'string' ? b.title.replace(/[\u0000-\u001f]/g, '').trim().slice(0, 80) : '';
  return {
    mode: b.mode, count, perQuestion, totalSeconds, title, shuffle: b.shuffle === true, shuffleOptions: b.shuffleOptions === true,
    filters: { papers: strs(f.papers, Object.keys(PAPERS)), systems: strs(f.systems, Object.keys(SYSTEMS)), status: strs(f.status, STATUSES.map(([s]) => s)) as Filters['status'], history },
  };
}

function shuffled<T>(a: T[]) {
  const r = [...a];
  for (let i = r.length - 1; i > 0; i--) { const j = randomInt(i + 1); [r[i], r[j]] = [r[j], r[i]]; }
  return r;
}

const insert = (userId: number, mode: Mode, title: string, config: object, items: Item[], timeLimit: number | null) =>
  Number(db.prepare('INSERT INTO exams (user_id, mode, title, config, items, time_limit, started_at) VALUES (?, ?, ?, ?, ?, ?, ?)')
    .run(userId, mode, title, JSON.stringify({ ...config, pos: 0 }), JSON.stringify(items), timeLimit, now()).lastInsertRowid);

export function createExam(userId: number, b: Build): number | string {
  const list = pool.filter(matcher(b.filters, mine(userId)));
  if (!list.length) return 'No questions match these filters.';
  const picked = (b.shuffle ? shuffled(list) : list).slice(0, b.count);
  const items: Item[] = picked.map((p) => {
    const letters = Object.keys(mcqByQid.get(p.qid)!.options);
    return b.shuffleOptions ? { q: p.qid, o: shuffled(letters).join('') } : { q: p.qid };
  });
  const n = items.length, seconds = b.perQuestion * n || b.totalSeconds;
  const title = b.title || (b.mode === 'exam' ? `Timed exam · ${n} question${n === 1 ? '' : 's'}` : `Custom quiz · ${n} question${n === 1 ? '' : 's'}`);
  return insert(userId, b.mode, title, { filters: b.filters, shuffle: b.shuffle, shuffleOptions: b.shuffleOptions, perQuestion: b.perQuestion || null }, items, b.mode === 'exam' ? seconds : null);
}

export const toacsGroup = (sourceFile: string) => shortFile(sourceFile).replace(/^WhatsApp Image .*/, 'WhatsApp images');
export const toacsGroups = () => [...new Set(images.map((i) => toacsGroup(i.sourceFile)))].map((g) => ({ group: g, n: images.filter((i) => toacsGroup(i.sourceFile) === g).length }));

export function createToacs(userId: number, count: number, seconds: number, group: string, files?: string[], title?: string): number | string {
  if (!TOACS_SECONDS.includes(seconds)) return 'Choose 30, 60, 90 or 120 seconds per station.';
  let list = files ? images.filter((i) => files.includes(i.file)).sort((a, b) => files.indexOf(a.file) - files.indexOf(b.file)) : images.filter((i) => !group || toacsGroup(i.sourceFile) === group);
  if (!list.length) return 'No images in that source.';
  if (!files) list = shuffled(list).slice(0, Math.max(5, Math.min(30, count)));
  return insert(userId, 'toacs', title || `TOACS · ${list.length} stations`, { seconds, group }, list.map((i) => ({ q: i.file })), null);
}

// ---- reading -------------------------------------------------------------
export const own = (userId: number, id: number) => db.prepare('SELECT * FROM exams WHERE id = ? AND user_id = ?').get(id, userId) as ExamRow | undefined;
export const itemsOf = (e: ExamRow) => JSON.parse(e.items) as Item[];
export const configOf = (e: ExamRow) => JSON.parse(e.config) as { pos?: number; seconds?: number; group?: string; filters?: Filters };
export const deadlineOf = (e: ExamRow) => (e.time_limit ? e.started_at + e.time_limit * 1000 : null);
export const answersOf = (examId: number) => new Map((db.prepare('SELECT item_id, choice, correct, flagged, ms, answered_at FROM exam_answers WHERE exam_id = ?').all(examId) as AnswerRow[]).map((a) => [a.item_id, a]));

// Opening a timed session after its deadline settles it first.
export function load(userId: number, id: number) {
  const e = own(userId, id);
  if (!e) return null;
  const dl = deadlineOf(e);
  return !e.finished_at && dl && now() > dl + GRACE ? finishRow(e) : e;
}

// ---- answering -----------------------------------------------------------
export interface Save { item: string; choice?: string | null; flagged?: boolean; ms?: number; pos?: number }
type SaveResult = { ok: true; correct?: number | null; key?: string } | { error: string; status: number; finished?: boolean };

// One transaction: the exam_answers row and any mcq_attempts row land together.
export const saveAnswer = (userId: number, examId: number, s: Save) => db.transaction(() => save(userId, examId, s))();

function save(userId: number, examId: number, s: Save): SaveResult {
  const e = own(userId, examId);
  if (!e) return { error: 'Session not found.', status: 404 };
  if (e.finished_at) return { error: 'This session is already finished.', status: 409, finished: true };
  const items = itemsOf(e);
  if (!items.some((i) => i.q === s.item)) return { error: 'That item is not in this session.', status: 400 };
  const dl = deadlineOf(e);
  if (dl && now() > dl + GRACE) { finishRow(e); return { error: 'Time is up.', status: 409, finished: true }; }

  const prev = db.prepare('SELECT item_id, choice, correct, flagged, ms, answered_at FROM exam_answers WHERE exam_id = ? AND item_id = ?').get(examId, s.item) as AnswerRow | undefined;
  let { choice = null, correct = null, flagged = 0, ms = 0, answered_at = null } = prev ?? {};
  ms = Math.min(ms + Math.max(0, Math.min(MAX_ITEM_MS, Math.round(s.ms ?? 0))), 24 * 3_600_000);
  if (s.flagged !== undefined) flagged = s.flagged ? 1 : 0;
  let feedback: { correct: number | null; key: string } | undefined;

  if (s.choice !== undefined) {
    if (e.mode === 'toacs') {
      if (!GRADES.includes(s.choice as Grade)) return { error: 'Grade with got, partial or missed.', status: 400 };
      choice = s.choice; correct = choice === 'got' ? 1 : choice === 'missed' ? 0 : null; answered_at = now();
    } else {
      const m = mcqByQid.get(s.item)!;
      if (s.choice !== null && !Object.hasOwn(m.options, s.choice)) return { error: 'Unknown option.', status: 400 };
      if (e.mode === 'quiz') {
        if (choice) return { error: 'You already checked this question.', status: 409 };
        if (s.choice === null) return { error: 'Choose an option first.', status: 400 };
        feedback = recordAttempt(userId, m.qid, s.choice, ms, 'quiz')!;
        correct = feedback.correct;
      }
      choice = s.choice; answered_at = choice ? now() : null;
    }
  }
  db.prepare(`INSERT INTO exam_answers (exam_id, item_id, choice, correct, flagged, ms, answered_at) VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (exam_id, item_id) DO UPDATE SET choice = excluded.choice, correct = excluded.correct, flagged = excluded.flagged, ms = excluded.ms, answered_at = excluded.answered_at`)
    .run(examId, s.item, choice, correct, flagged, ms, answered_at);
  if (s.pos !== undefined && s.pos >= 0 && s.pos < items.length) db.prepare(`UPDATE exams SET config = json_set(config, '$.pos', ?) WHERE id = ?`).run(s.pos, examId);
  return feedback ? { ok: true, ...feedback } : { ok: true };
}

export function finish(userId: number, id: number) {
  const e = own(userId, id);
  return e ? (e.finished_at ? e : finishRow(e)) : null;
}

function finishRow(e: ExamRow): ExamRow {
  return db.transaction(() => {
    const fresh = db.prepare('SELECT * FROM exams WHERE id = ?').get(e.id) as ExamRow;
    if (fresh.finished_at) return fresh;
    const items = itemsOf(fresh), ans = answersOf(fresh.id);
    let score = 0, total = 0;
    if (fresh.mode === 'toacs') {
      total = items.length;
      for (const a of ans.values()) score += a.choice === 'got' ? 1 : a.choice === 'partial' ? 0.5 : 0;
    } else {
      const mark = db.prepare('UPDATE exam_answers SET correct = ? WHERE exam_id = ? AND item_id = ?');
      for (const { q } of items) {
        const m = mcqByQid.get(q), a = ans.get(q);
        if (!m) continue;
        if (m.key) total++;
        if (!a?.choice) continue;
        if (fresh.mode === 'exam') {
          const r = recordAttempt(fresh.user_id, q, a.choice, a.ms, 'exam');
          mark.run(r?.correct ?? null, fresh.id, q);
          if (r?.correct === 1) score++;
        } else if (a.correct === 1) score++;
      }
    }
    const dl = deadlineOf(fresh);
    const at = dl ? Math.min(now(), dl) : now();
    db.prepare('UPDATE exams SET finished_at = ?, score = ?, total = ? WHERE id = ?').run(at, score, total, fresh.id);
    return { ...fresh, finished_at: at, score, total };
  })();
}

// "Retake wrong ones" / "Repeat missed": a fresh practice session from what was not got right.
export function retake(userId: number, id: number): number | string {
  const e = own(userId, id);
  if (!e?.finished_at) return 'Finish the session first.';
  const ans = answersOf(e.id), items = itemsOf(e);
  if (e.mode === 'toacs') {
    const files = items.filter((i) => ans.get(i.q)?.choice !== 'got').map((i) => i.q);
    if (!files.length) return 'Nothing missed in this session.';
    return createToacs(userId, files.length, configOf(e).seconds ?? 60, '', files, `Repeat missed · ${files.length} station${files.length === 1 ? '' : 's'}`);
  }
  const qs = items.filter((i) => mcqByQid.get(i.q)?.key && ans.get(i.q)?.correct !== 1).map((i) => ({ q: i.q }));
  if (!qs.length) return 'No wrong answers to retake.';
  return insert(userId, 'quiz', `Retake · ${qs.length} wrong or unanswered`, { retakeOf: e.id }, qs, null);
}

// ---- views ---------------------------------------------------------------
export function playerItems(e: ExamRow) {
  return itemsOf(e).map(({ q, o }) => {
    const m = mcqByQid.get(q)!;
    const order = o ? o.split('') : Object.keys(m.options);
    const base = { qid: m.qid, paper: m.paper, stem: m.stem, options: order.map((l) => [l, m.options[l]] as [string, string]) };
    // Practice mode shows feedback in place; exam mode keeps keys server-side until the end.
    return e.mode === 'quiz'
      ? { ...base, key: m.key, keyEvidence: m.keyEvidence, myAnswer: m.myAnswer, confidence: m.confidence, reason: m.reason, verdict: m.verdict, evidence: m.evidence, note: m.note, notBlind: m.notBlind, notBlindReason: m.notBlindReason }
      : base;
  });
}

export function results(e: ExamRow) {
  const ans = answersOf(e.id);
  const rows = itemsOf(e).map(({ q }, n) => {
    const m = mcqByQid.get(q)!, a = ans.get(q), p = poolByQid.get(q)!;
    const correct = a?.choice && m.key ? (a.choice === m.key ? 1 : 0) : null;
    return { n: n + 1, m, system: p.system, choice: a?.choice ?? null, correct, flagged: !!a?.flagged, ms: a?.ms ?? 0, keyed: !!m.key, disputed: m.verdict === 'DISPUTED' };
  });
  const answered = rows.filter((r) => r.choice).length;
  const totalMs = rows.reduce((s, r) => s + r.ms, 0);
  const group = (key: (r: (typeof rows)[number]) => string) => {
    const g = new Map<string, { n: number; keyed: number; right: number }>();
    for (const r of rows) { const x = g.get(key(r)) ?? { n: 0, keyed: 0, right: 0 }; x.n++; if (r.keyed) x.keyed++; if (r.correct === 1) x.right++; g.set(key(r), x); }
    return [...g].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.n - a.n);
  };
  return {
    rows, answered,
    right: rows.filter((r) => r.correct === 1).length,
    wrong: rows.filter((r) => r.correct === 0).length,
    unanswered: rows.length - answered,
    unscored: rows.filter((r) => !r.keyed).length,
    flagged: rows.filter((r) => r.flagged).length,
    disputed: rows.filter((r) => r.disputed).length,
    keyed: rows.filter((r) => r.keyed).length,
    timeUsed: (e.finished_at ?? now()) - e.started_at,
    avgMs: answered ? totalMs / answered : 0,
    byPaper: group((r) => r.m.paper),
    bySystem: group((r) => r.system),
  };
}

export function toacsStations(e: ExamRow) {
  const byFile = new Map(images.map((i) => [i.file, i]));
  return itemsOf(e).map(({ q }) => {
    const im = byFile.get(q)!;
    const fs = facts.filter((f) => f.file === im.sourceFile && f.unit === im.page)
      .sort((a, b) => Number(a.status !== 'verified') - Number(b.status !== 'verified'))
      .map((f) => ({ id: f.id, fact: f.fact, label: f.label }));
    return { file: im.file, caption: im.caption, sourceFile: im.sourceFile, page: im.page, group: toacsGroup(im.sourceFile), facts: fs };
  });
}

export function recent(userId: number, limit = 5) {
  return (db.prepare(`SELECT e.id, e.mode, e.title, e.started_at, e.finished_at, e.score, e.total, e.time_limit, json_array_length(e.items) n,
                        (SELECT COUNT(*) FROM exam_answers a WHERE a.exam_id = e.id AND a.choice IS NOT NULL) answered
                      FROM exams e WHERE e.user_id = ? ORDER BY e.started_at DESC, e.id DESC LIMIT ?`).all(userId, limit) as (Pick<ExamRow, 'id' | 'mode' | 'title' | 'started_at' | 'finished_at' | 'score' | 'total' | 'time_limit'> & { n: number; answered: number })[])
    .map((r) => ({ ...r, expired: !r.finished_at && !!r.time_limit && now() > r.started_at + r.time_limit * 1000 + GRACE }));
}

export const examHref = (r: { id: number; mode: Mode }) => (r.mode === 'toacs' ? `/practice/toacs/${r.id}` : `/practice/exam/${r.id}`);
