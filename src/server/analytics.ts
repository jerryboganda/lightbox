import { default_w, forgetting_curve, State } from 'ts-fsrs';
import { db, now } from './db';
import { cardByFact, cards, facts, mcqs, SYSTEMS, systemOrder, topicBySlug, topics } from '../lib/data';

export const DAY = 86_400_000;
const TZ_MS = 5 * 3_600_000; // Pakistan time, as in progress.ts
export const dayStart = (t = now()) => Math.floor((t + TZ_MS) / DAY) * DAY - TZ_MS;
export const dayKey = (t: number) => new Date(t + TZ_MS).toISOString().slice(0, 10);
const weekStart = (t = now()) => { const d = dayStart(t); return d - ((new Date(d + TZ_MS).getUTCDay() + 6) % 7) * DAY; };
const MAX_ANSWER_MS = 10 * 60_000; // one answer never counts for more than 10 minutes

// ---- goals ----
export interface Goals { cards: number; mcqs: number; minutes: number; examDate: string | null }
export const GOAL_MAX = { cards: 500, mcqs: 500, minutes: 720 } as const;

export function getGoals(userId: number): Goals {
  const r = db.prepare('SELECT cards, mcqs, minutes, exam_date FROM goals WHERE user_id = ?').get(userId) as any;
  return r ? { cards: r.cards, mcqs: r.mcqs, minutes: r.minutes, examDate: r.exam_date } : { cards: 30, mcqs: 20, minutes: 60, examDate: null };
}

const validDate = (s: string) => {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(s + 'T00:00:00Z');
  return !Number.isNaN(d.getTime()) && d.toISOString().startsWith(s) && d.getUTCFullYear() >= 2000 && d.getUTCFullYear() <= 2100;
};

/** Validates and saves; returns the saved goals or an error message. */
export function setGoals(userId: number, body: unknown): Goals | string {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  for (const k of ['cards', 'mcqs', 'minutes'] as const) {
    const n = b[k];
    if (typeof n !== 'number' || !Number.isInteger(n) || n < 0 || n > GOAL_MAX[k]) return `${k === 'minutes' ? 'Focus minutes' : k === 'mcqs' ? 'MCQs' : 'Cards'} must be a whole number from 0 to ${GOAL_MAX[k]}.`;
  }
  const d = b.examDate === '' || b.examDate === undefined ? null : b.examDate;
  if (d !== null && (typeof d !== 'string' || !validDate(d))) return 'Exam date must be a real date (YYYY-MM-DD).';
  db.prepare(`INSERT INTO goals (user_id, cards, mcqs, minutes, exam_date, updated_at) VALUES (?, ?, ?, ?, ?, ?)
              ON CONFLICT (user_id) DO UPDATE SET cards = excluded.cards, mcqs = excluded.mcqs, minutes = excluded.minutes, exam_date = excluded.exam_date, updated_at = excluded.updated_at`)
    .run(userId, b.cards, b.mcqs, b.minutes, d, now());
  return getGoals(userId);
}

export const daysUntil = (date: string | null) => (date ? Math.round((Date.parse(date + 'T00:00:00+05:00') - dayStart()) / DAY) : null);

// ---- raw activity ----
type Answer = { t: number; correct: number | null; ms: number; qid: string; mode: string };
// Bank answers live in mcq_attempts; quiz, exam and TOACS answers in exam_answers. mcq_attempts rows with
// source quiz/exam mirror exam_answers, so only source = 'bank' is read from there to avoid double counting.
const answers = (userId: number, since: number) => db.prepare(`
  SELECT created_at t, correct, COALESCE(ms, 0) ms, qid, 'bank' mode FROM mcq_attempts WHERE user_id = ? AND source = 'bank' AND created_at >= ?
  UNION ALL
  SELECT a.answered_at, a.correct, a.ms, a.item_id, e.mode FROM exam_answers a JOIN exams e ON e.id = a.exam_id
  WHERE e.user_id = ? AND a.answered_at >= ?`).all(userId, since, userId, since) as Answer[];

export function today(userId: number) {
  const t0 = dayStart(), goals = getGoals(userId);
  const cardsDone = (db.prepare('SELECT COUNT(*) n FROM srs_log WHERE user_id = ? AND reviewed_at >= ?').get(userId, t0) as any).n as number;
  const mcqsDone = answers(userId, t0).filter((a) => a.mode !== 'toacs').length;
  const focus = (db.prepare("SELECT COALESCE(SUM(seconds), 0) s FROM study_sessions WHERE user_id = ? AND kind = 'focus' AND started_at >= ?").get(userId, t0) as any).s as number;
  return { goals, done: { cards: cardsDone, mcqs: mcqsDone, minutes: Math.floor(focus / 60) }, examDays: daysUntil(goals.examDate) };
}

/** Idempotent on clientId. Returns false for anything out of bounds. */
export function recordSession(userId: number, b: any) {
  const { kind, seconds, startedAt, clientId } = b ?? {};
  if (kind !== 'focus' && kind !== 'break') return false;
  if (!Number.isInteger(seconds) || seconds < 1 || seconds > 4 * 3600) return false;
  if (!Number.isInteger(startedAt) || startedAt < now() - 7 * DAY || startedAt > now() + 60_000) return false;
  if (typeof clientId !== 'string' || !/^[\w-]{8,64}$/.test(clientId)) return false;
  db.prepare('INSERT INTO study_sessions (user_id, kind, started_at, seconds, client_id) VALUES (?, ?, ?, ?, ?) ON CONFLICT (client_id) DO NOTHING')
    .run(userId, kind, startedAt, seconds, clientId);
  return true;
}

// ---- content maps (built once) ----
const norm = (f: string) => f.replace(/__u\d+\.txt$/, '').replace(/\.\w+$/, '').replace(/[^a-z0-9]/gi, '').toLowerCase();
const topicFacts = new Map(topics.map((t) => [t.slug, [...new Set(t.sections.flatMap((s) => s.bullets.flatMap((b) => b.ids)))]]));
const factTopics = new Map<string, string[]>();
for (const [slug, ids] of topicFacts) for (const id of ids) factTopics.set(id, [...(factTopics.get(id) ?? []), slug]);
const pageTopics = new Map<string, Set<string>>();
for (const f of facts) {
  const k = `${norm(f.file)}|${f.unit}`;
  for (const s of factTopics.get(f.id) ?? []) (pageTopics.get(k) ?? pageTopics.set(k, new Set()).get(k)!).add(s);
}
// A wrong MCQ points at the topics whose facts come from the same paper page.
const mcqTopics = new Map(mcqs.map((m) => [m.qid, [...(pageTopics.get(`${norm(m.file)}|${m.unit}`) ?? [])]]));
const factSystem = new Map(facts.map((f) => [f.id, f.system]));

export const SHORT: Record<string, string> = {
  neuro: 'Neuro', chest: 'Chest', abdomen: 'Abdomen', gu: 'GU', 'gyn-obs': 'Gyn/Obs', breast: 'Breast', msk: 'MSK', pediatrics: 'Paeds',
  ent: 'Head/neck', vascular: 'Vascular', 'nuclear-med': 'Nuc med', physics: 'Physics', procedures: 'Procedures', other: 'Other',
};

type FsrsJson = { state: number; stability: number; last_review?: string; lapses: number; scheduled_days: number };
const recall = (c: FsrsJson, at: number) =>
  c.stability > 0 && c.last_review ? forgetting_curve(default_w, Math.max(0, (at - Date.parse(c.last_review)) / DAY), c.stability) : null;
/** 3720 -> "1 h 2 min" */
export const hm = (s: number) => { const m = Math.round(s / 60); return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}`; };
const plural = (n: number, one: string, many = one + 's') => `${n} ${n === 1 ? one : many}`;

export function analytics(userId: number) {
  const t = now(), t0 = dayStart(t), w0 = weekStart(t);
  const since = w0 - 52 * 7 * DAY; // a year of history for streaks
  const rv = db.prepare('SELECT reviewed_at t FROM srs_log WHERE user_id = ? AND reviewed_at >= ?').all(userId, since) as { t: number }[];
  const an = answers(userId, since);
  const ss = db.prepare("SELECT started_at t, seconds FROM study_sessions WHERE user_id = ? AND kind = 'focus' AND started_at >= ?").all(userId, since) as { t: number; seconds: number }[];

  // per-day totals
  type Day = { reviews: number; answers: number; focus: number; exam: number; mcq: number };
  const days = new Map<string, Day>();
  const at = (ts: number) => { const k = dayKey(ts); let d = days.get(k); if (!d) days.set(k, (d = { reviews: 0, answers: 0, focus: 0, exam: 0, mcq: 0 })); return d; };
  for (const r of rv) at(r.t).reviews++;
  for (const a of an) { const d = at(a.t); d.answers++; d[a.mode === 'bank' ? 'mcq' : 'exam'] += Math.min(Math.max(a.ms, 0), MAX_ANSWER_MS) / 1000; }
  for (const s of ss) at(s.t).focus += s.seconds;
  const dayOf = (ts: number) => days.get(dayKey(ts));
  const score = (ts: number) => { const d = dayOf(ts); return d ? d.reviews + d.answers + Math.round(d.focus / 60) : 0; };

  // heatmap: 26 week columns, Monday first
  const hmStart = w0 - 25 * 7 * DAY;
  let max = 0;
  for (let d = hmStart; d <= t0; d += DAY) max = Math.max(max, score(d));
  const weeks = Array.from({ length: 26 }, (_, c) => Array.from({ length: 7 }, (_, r) => {
    const ts = hmStart + (c * 7 + r) * DAY, d = dayOf(ts), s = score(ts);
    return { day: dayKey(ts), future: ts > t0, score: s, level: s ? Math.min(4, Math.ceil((4 * s) / max)) : 0,
      reviews: d?.reviews ?? 0, answers: d?.answers ?? 0, minutes: Math.round((d?.focus ?? 0) / 60) };
  }));
  const months = weeks.flatMap((w, c) => {
    const first = w.find((d) => d.day.endsWith('-01')) ?? (c === 0 ? w[0] : null);
    return first ? [{ col: c, label: new Date(first.day + 'T00:00:00Z').toLocaleString('en', { month: 'short', timeZone: 'UTC' }) }] : [];
  }).filter((m, i, a) => !(i === 0 && a[1] && a[1].col - m.col < 3)); // drop a cramped leading partial month
  let current = 0;
  for (let d = score(t0) ? t0 : t0 - DAY; d >= since && score(d) > 0; d -= DAY) current++;
  let longest = 0, run = 0;
  for (let d = since; d <= t0; d += DAY) { run = score(d) ? run + 1 : 0; longest = Math.max(longest, run); }
  const activeIn = (n: number) => Array.from({ length: n }, (_, i) => score(t0 - i * DAY)).filter(Boolean).length;
  const active14 = activeIn(14), active28 = activeIn(28);
  const hmActive = weeks.flat().filter((d) => d.score > 0).length;

  // cards: mastery by system, forgetting curve, retention
  const srs = (db.prepare('SELECT fact_id, card FROM srs_cards WHERE user_id = ?').all(userId) as { fact_id: string; card: string }[])
    .map((r) => ({ id: r.fact_id, c: JSON.parse(r.card) as FsrsJson }));
  const sys: Record<string, { total: number; seen: number; strong: number }> = {};
  for (const c of cards) (sys[factSystem.get(c.factId) || 'other'] ??= { total: 0, seen: 0, strong: 0 }).total++;
  let seenCorpus = 0;
  for (const { id, c } of srs) {
    if (!cardByFact.has(id)) continue; // personal cards (U…) are not part of corpus coverage
    seenCorpus++;
    const m = sys[factSystem.get(id) || 'other'];
    m.seen++;
    if (c.state === State.Review && c.scheduled_days >= 7) m.strong++;
  }
  const mastery = systemOrder.filter((s) => sys[s]?.total).map((s) => ({ key: s, label: SYSTEMS[s].label, short: SHORT[s] ?? s, ...sys[s] }));

  const reviewed = srs.filter(({ c }) => c.state !== State.New && recall(c, t) !== null);
  const curve = Array.from({ length: 31 }, (_, d) => ({
    day: d,
    recall: reviewed.length ? reviewed.reduce((sum, { c }) => sum + recall(c, t + d * DAY)!, 0) / reviewed.length : 0,
  }));
  const now90 = reviewed.filter(({ c }) => recall(c, t)! >= 0.9);
  const dropping = now90.filter(({ c }) => recall(c, t + 7 * DAY)! < 0.9).length;
  const below = reviewed.length - now90.length;

  // MCQ accuracy by week (every keyed answer, repeats included)
  const quiz = an.filter((a) => a.mode !== 'toacs');
  const wk0 = w0 - 11 * 7 * DAY;
  const trend = Array.from({ length: 12 }, (_, i) => ({ start: dayKey(wk0 + i * 7 * DAY), n: 0, keyed: 0, right: 0, acc: null as number | null }));
  for (const a of quiz) {
    const i = Math.floor((a.t - wk0) / (7 * DAY));
    if (i < 0 || i > 11) continue;
    trend[i].n++;
    if (a.correct !== null) { trend[i].keyed++; trend[i].right += a.correct ? 1 : 0; }
  }
  for (const w of trend) w.acc = w.keyed ? w.right / w.keyed : null;

  // time spent, last 14 days (seconds)
  const time = Array.from({ length: 14 }, (_, i) => {
    const ts = t0 - (13 - i) * DAY, d = dayOf(ts);
    return { day: dayKey(ts), focus: d?.focus ?? 0, exam: Math.round(d?.exam ?? 0), mcq: Math.round(d?.mcq ?? 0) };
  });
  const sum = (xs: typeof time) => xs.reduce((s, d) => s + d.focus + d.exam + d.mcq, 0);

  // readiness: transparent weighted blend; a part with too little evidence counts as zero
  const recent = quiz.filter((a) => a.correct !== null).sort((a, b) => b.t - a.t).slice(0, 50);
  const retention = reviewed.length >= 10 ? reviewed.reduce((s, { c }) => s + recall(c, t)!, 0) / reviewed.length : null;
  const accuracy = recent.length >= 10 ? recent.filter((a) => a.correct).length / recent.length : null;
  const parts = [
    { key: 'coverage', label: 'Coverage', weight: 0.3, value: seenCorpus / cards.length, note: `${seenCorpus} of ${cards.length} flashcards started` },
    { key: 'retention', label: 'Retention', weight: 0.3, value: retention, note: retention === null ? `Counts once 10 cards are reviewed (${reviewed.length} so far)` : `Average predicted recall of ${plural(reviewed.length, 'reviewed card')} today` },
    { key: 'accuracy', label: 'MCQ accuracy', weight: 0.25, value: accuracy, note: accuracy === null ? `Counts after 10 keyed answers (${recent.length} so far)` : `Your last ${recent.length} keyed answers` },
    { key: 'consistency', label: 'Consistency', weight: 0.15, value: active14 / 14, note: `${active14} of the last 14 days active` },
  ];
  const readiness = Math.round(100 * parts.reduce((s, p) => s + p.weight * (p.value ?? 0), 0));

  return {
    heatmap: { weeks, months, current, longest, active28, activeDays: hmActive },
    mastery, curve, dropping, below, reviewedCount: reviewed.length,
    trend, time, weekSeconds: sum(time.slice(7)), prevWeekSeconds: sum(time.slice(0, 7)),
    readiness: { score: readiness, parts },
    weak: weakTopics(userId, srs, quiz),
  };
}

function weakTopics(userId: number, srs: { id: string; c: FsrsJson }[], quiz: Answer[]) {
  const ev = new Map<string, { lapses: number; again: number; wrong: number; marked: number }>();
  const factScore = new Map<string, number>();
  const bump = (slugs: Iterable<string> | undefined, k: 'lapses' | 'again' | 'wrong' | 'marked', n = 1) => {
    for (const s of slugs ?? []) { let e = ev.get(s); if (!e) ev.set(s, (e = { lapses: 0, again: 0, wrong: 0, marked: 0 })); e[k] += n; }
  };
  for (const { id, c } of srs) if (c.lapses > 0) { bump(factTopics.get(id), 'lapses', c.lapses); factScore.set(id, (factScore.get(id) ?? 0) + 2 * c.lapses); }
  for (const r of db.prepare('SELECT fact_id, COUNT(*) n FROM srs_log WHERE user_id = ? AND rating = 1 GROUP BY fact_id').all(userId) as { fact_id: string; n: number }[]) {
    bump(factTopics.get(r.fact_id), 'again', r.n);
    factScore.set(r.fact_id, (factScore.get(r.fact_id) ?? 0) + r.n);
  }
  for (const a of quiz) if (a.correct === 0) bump(mcqTopics.get(a.qid), 'wrong');
  for (const m of db.prepare("SELECT item_type, item_id FROM marks WHERE user_id = ? AND kind = 'weak'").all(userId) as { item_type: string; item_id: string }[]) {
    bump(m.item_type === 'topic' ? (topicFacts.has(m.item_id) ? [m.item_id] : []) : m.item_type === 'mcq' ? mcqTopics.get(m.item_id) : factTopics.get(m.item_id), 'marked');
  }
  return [...ev].map(([slug, e]) => {
    const t = topicBySlug.get(slug)!;
    const reason = [
      e.lapses && plural(e.lapses, 'lapse'), e.again && plural(e.again, 'Again rating'), e.wrong && plural(e.wrong, 'wrong MCQ'),
      e.marked && (e.marked === 1 ? 'marked weak' : `${e.marked} weak marks`),
    ].filter(Boolean).join(', ');
    const drill = (topicFacts.get(slug) ?? []).filter((id) => cardByFact.has(id)).sort((a, b) => (factScore.get(b) ?? 0) - (factScore.get(a) ?? 0))[0] ?? null;
    return { slug, title: t.title, system: t.system, systemLabel: SYSTEMS[t.system]?.label ?? t.system, href: `/study/${t.system}/${slug}`,
      score: 2 * e.lapses + e.again + 2 * e.wrong + 3 * e.marked, reason, drill };
  }).sort((a, b) => b.score - a.score || a.title.localeCompare(b.title)).slice(0, 8);
}
