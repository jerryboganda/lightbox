import { db, now } from './db';
import { cards, SYSTEMS, systemOrder, topics } from '../lib/data';
import { matcher } from '../lib/quiz';
import { dayKey, daysUntil, factSystem, getGoals, SHORT, weakOnly } from './analytics';
import { mine, pool } from './exams';
import { dueMistakes } from './mistakes';
import { byConfidence, getProfile } from './profile';
import { srsQueue } from './progress';

// "What should I do today?": turns a time budget into an ordered list of steps that each open a ready session.
// Pure reads; sessions (quiz, TOACS) are created only when the student presses Start on a step.
export const BUDGETS = [15, 30, 60] as const;
const RATE = { review: 7, fresh: 3, mcq: 1, mistake: 1.2 }; // items per minute

export type Start = { type: 'exam'; body: Record<string, unknown> } | { type: 'toacs'; fields: Record<string, string> };
export interface Step { id: string; kind: 'review' | 'mistakes' | 'new' | 'quiz' | 'read' | 'toacs'; title: string; detail: string; minutes: number; href?: string; start?: Start }
export interface Plan { minutes: number; used: number; focus: { system: string; label: string; why: string } | null; examDays: number | null; steps: Step[] }

function pickFocus(uid: number, weak: ReturnType<typeof weakOnly>) {
  const p = getProfile(uid);
  const seen = new Map<string, { seen: number; strong: number }>();
  for (const r of db.prepare('SELECT fact_id, card FROM srs_cards WHERE user_id = ?').all(uid) as { fact_id: string; card: string }[]) {
    const s = factSystem.get(r.fact_id); if (!s) continue;
    const m = seen.get(s) ?? { seen: 0, strong: 0 };
    m.seen++;
    const c = JSON.parse(r.card);
    if (c.state === 2 && c.scheduled_days >= 7) m.strong++;
    seen.set(s, m);
  }
  const total = new Map<string, number>();
  for (const c of cards) { const s = factSystem.get(c.factId); if (s) total.set(s, (total.get(s) ?? 0) + 1); }
  const weakIn = new Map<string, number>();
  for (const w of weak) weakIn.set(w.system, (weakIn.get(w.system) ?? 0) + w.score);
  const maxWeak = Math.max(1, ...weakIn.values());
  // Today's date nudges ties so equal systems rotate instead of the same one winning every day.
  const salt = [...dayKey(now())].reduce((h, c) => (h * 31 + c.charCodeAt(0)) >>> 0, 7);
  const scored = systemOrder.filter((s) => total.get(s)).map((s, i) => {
    const n = total.get(s)!, m = seen.get(s) ?? { seen: 0, strong: 0 };
    const conf = p.confidence[s] ?? 3;
    const score = 0.35 * ((5 - conf) / 4) + 0.3 * (1 - m.strong / n) + 0.1 * (1 - m.seen / n) + 0.25 * ((weakIn.get(s) ?? 0) / maxWeak) + ((salt >> i) % 7) / 1000;
    const why = (weakIn.get(s) ?? 0) > 0 ? 'your weak topics cluster here' : conf <= 2 ? `you rated it ${conf}/5` : m.seen < n / 4 ? `only ${m.seen} of ${n} cards started` : 'lowest mastery right now';
    return { s, score, why };
  }).sort((a, b) => b.score - a.score);
  const top = scored[0] ?? (byConfidence(p)[0] ? { s: byConfidence(p)[0], why: '' } : null);
  return top ? { system: top.s, label: SYSTEMS[top.s]?.label ?? top.s, why: top.why } : null;
}

export function plan(uid: number, minutes: number): Plan {
  const m = Math.max(10, Math.min(240, Math.round(minutes) || 30));
  const goals = getGoals(uid), examDays = daysUntil(goals.examDate);
  const weak = weakOnly(uid);
  const focus = pickFocus(uid, weak);
  const sys = focus?.system ?? null, short = sys ? SHORT[sys] ?? focus!.label : '';
  const q = srsQueue(uid, { system: sys });
  const steps: Step[] = [];
  let left = m;
  const take = (want: number) => { const t = Math.max(0, Math.min(left, want)); left -= t; return t; };

  // 1. due reviews: the cheapest retention there is, but never more than ~45% of the session
  if (q.due.length) {
    const t = take(Math.min(Math.ceil(q.due.length / RATE.review), Math.ceil(m * 0.45)));
    const n = Math.min(q.due.length, Math.round(t * RATE.review));
    if (n) steps.push({ id: 'review', kind: 'review', minutes: t, title: `Review ${n} due card${n === 1 ? '' : 's'}`, href: `/practice/cards?only=due&limit=${n}`,
      detail: q.due.length > n ? `${q.due.length - n} more stay due for later; most overdue first.` : 'Clears every card due now.' });
  }
  // 2. mistakes coming back on schedule
  const mist = dueMistakes(uid);
  if (mist.length && left > 0) {
    const n = Math.min(mist.length, m >= 60 ? 8 : 5);
    const t = take(Math.ceil(n / RATE.mistake));
    if (t) steps.push({ id: 'mistakes', kind: 'mistakes', minutes: t, title: `Retry ${n} past mistake${n === 1 ? '' : 's'}`, href: '/practice/mcq?set=mistakes',
      detail: 'Questions you missed, back on a 1-3-7-21 day schedule. Get them right to clear them.' });
  }
  // 3. new cards, from the focus system first
  const close = examDays !== null && examDays >= 0 && examDays <= 14; // last fortnight: consolidate, learn little new
  if (q.fresh.length && left > 0 && !close) {
    const t = take(Math.ceil(Math.min(q.fresh.length, (m >= 60 ? 0.25 : 0.3) * m * RATE.fresh) / RATE.fresh));
    const n = Math.min(q.fresh.length, Math.round(t * RATE.fresh));
    if (n) steps.push({ id: 'new', kind: 'new', minutes: t, title: `Learn ${n} new ${short} card${n === 1 ? '' : 's'}`.replace('  ', ' '), href: `/practice/cards?only=new&limit=${n}${sys ? `&sys=${sys}` : ''}`,
      detail: focus ? `Focus: ${focus.label}, because ${focus.why}.` : 'Next cards in the deck.' });
  }
  // 4. a short quiz: unanswered questions in the focus system, else anything keyed in it, else anything keyed
  if (left >= 4) {
    const my = mine(uid);
    const tries = [
      { systems: sys ? [sys] : [], history: 'unanswered' as const, label: `${short} questions you have not tried` },
      { systems: sys ? [sys] : [], history: 'any' as const, label: `${short} questions` },
      { systems: [], history: 'unanswered' as const, label: 'questions you have not tried' },
      { systems: [], history: 'any' as const, label: 'mixed questions' },
    ];
    const want = Math.max(5, Math.min(40, Math.round((close ? 0.6 : 0.4) * m * RATE.mcq)));
    for (const tr of tries) {
      const filters = { papers: [], systems: tr.systems, status: ['keyed' as const], history: tr.history };
      const n = Math.min(want, pool.filter(matcher(filters, my)).length);
      if (n < 3) continue;
      const t = take(Math.ceil(n / RATE.mcq));
      steps.push({ id: 'quiz', kind: 'quiz', minutes: t, title: `Answer ${n} ${tr.label}`.replace('  ', ' '), detail: 'Keyed questions with instant feedback and the reason behind each key.',
        start: { type: 'exam', body: { mode: 'quiz', filters, count: n, shuffle: true, shuffleOptions: false, title: `Today's plan · ${n} questions` } } });
      break;
    }
  }
  // 5. one topic: Fix-it on the weakest, else one not opened yet in the focus system
  if (left >= 4) {
    const visited = new Set((db.prepare("SELECT ref FROM visits WHERE user_id = ? AND kind = 'topic'").all(uid) as { ref: string }[]).map((r) => r.ref));
    const w = weak[0];
    const fresh = topics.find((t) => t.system === sys && !visited.has(`/study/${t.system}/${t.slug}`));
    const pick = w ? { href: `/fix/${w.slug}`, title: `Fix: ${w.title}`, detail: `Weak spot: ${w.reason}. Key points, 10 cards, then 3 questions.` }
      : fresh ? { href: `/study/${fresh.system}/${fresh.slug}`, title: `Read: ${fresh.title}`, detail: 'Not opened yet. Try the quick check at the end.' } : null;
    if (pick) { const t = take(m >= 60 ? 10 : 6); steps.push({ id: 'read', kind: 'read', minutes: t, title: pick.title, href: pick.href, detail: pick.detail }); }
  }
  // 6. image stations for longer sessions or when the exam is near
  if (left >= 8 && (m >= 60 || (examDays !== null && examDays >= 0 && examDays <= 30))) {
    const n = Math.max(5, Math.min(20, Math.round(left * 0.8)));
    const t = take(Math.ceil(n * 1.2));
    steps.push({ id: 'toacs', kind: 'toacs', minutes: t, title: `${n} TOACS image stations`, detail: '60 seconds each, then self-grade against the caption.',
      start: { type: 'toacs', fields: { count: String(n), seconds: '60', group: '' } } });
  }
  return { minutes: m, used: m - left, focus, examDays, steps };
}
