import { createEmptyCard, fsrs, Rating, State, type Card as FCard, type FSRS, type Grade } from 'ts-fsrs';
import { db, now } from './db';
import { cardByFact, cards, facts, mcqs } from '../lib/data';
import { daysUntil, factTopics, getGoals, topicFacts } from './analytics';
import { trackMistake } from './mistakes';
import { DEFAULT_NEW, pacing } from './pacing';
import { retentionFor } from './profile';
import { liveStreak } from './streaks';

export const NEW_PER_DAY = DEFAULT_NEW; // without an exam date; pacing.ts sets it from the exam date otherwise
/** A card forgotten this many times is a leech: it gets marked weak and flagged in the session. */
export const LEECH = 4;
export type Confidence = 'sure' | 'unsure' | 'guess';
export const CONFIDENCE: readonly Confidence[] = ['sure', 'unsure', 'guess'];
const TZ_MS = 5 * 3_600_000; // Pakistan time for "today" and streaks
// One scheduler per desired retention (the user's setting, raised near the exam).
const schedulers = new Map<number, FSRS>();
const schedulerFor = (r: number) => {
  const k = Math.round(r * 100) / 100;
  let s = schedulers.get(k);
  if (!s) schedulers.set(k, (s = fsrs({ request_retention: k, enable_fuzz: true })));
  return s;
};
const dayStart = (t = now()) => Math.floor((t + TZ_MS) / 86_400_000) * 86_400_000 - TZ_MS;
const dayKey = (t: number) => new Date(t + TZ_MS).toISOString().slice(0, 10);

const revive = (s: string): FCard => {
  const c = JSON.parse(s);
  return { ...c, due: new Date(c.due), last_review: c.last_review ? new Date(c.last_review) : undefined };
};

const factSystem = new Map(facts.map((f) => [f.id, f.system]));
// Cards from the same source page are siblings; they shouldn't follow each other (one answers the next).
const factPage = new Map(facts.map((f) => [f.id, `${f.file}|${f.unit}`]));

/** Reorders so neighbours don't share a key, looking at most `look` items ahead to keep the original priority. */
export function spread<T>(xs: T[], key: (x: T) => string, look = 12): T[] {
  const rest = [...xs], out: T[] = [];
  let last: string | null = null;
  while (rest.length) {
    const lim = Math.min(look, rest.length);
    let k = 0;
    while (k < lim && key(rest[k]) === last) k++;
    const [x] = rest.splice(k < lim ? k : 0, 1);
    out.push(x);
    last = key(x);
  }
  return out;
}

// User-made cards are scheduled like fact cards under the id 'U<id>'. New ones come first and share the daily new limit.
const userCardNum = (id: string) => (/^U[1-9]\d{0,12}$/.test(id) ? Number(id.slice(1)) : 0);

/** Puts the items matching `first` ahead of the rest, keeping each group's order. */
const lead = <T>(xs: T[], first: (x: T) => boolean) => [...xs.filter(first), ...xs.filter((x) => !first(x))];

// focus.topic / focus.system put that topic's or system's cards first (planner and "Learn this topic" sessions).
export function srsQueue(userId: number, focus: { topic?: string | null; system?: string | null } = {}) {
  const mine = db.prepare('SELECT id, front, back, fact_id factId, path FROM user_cards WHERE user_id = ? ORDER BY id').all(userId) as { id: number; front: string; back: string; factId: string | null; path: string | null }[];
  const own = new Map(mine.map((c) => [`U${c.id}`, c]));
  const inTopic = focus.topic ? new Set(topicFacts.get(focus.topic) ?? []) : null;
  const wanted = (id: string) => (inTopic ? inTopic.has(id) : focus.system ? factSystem.get(id) === focus.system : false);
  const sib = (id: string) => factPage.get(own.get(id)?.factId ?? id) ?? id;
  const dueRows = (db.prepare('SELECT fact_id, card FROM srs_cards WHERE user_id = ? AND due <= ? ORDER BY due LIMIT 300').all(userId, now()) as { fact_id: string; card: string }[])
    .filter((r) => !r.fact_id.startsWith('U') || own.has(r.fact_id));
  const due = [...spread(dueRows.filter((r) => wanted(r.fact_id)), (r) => sib(r.fact_id)), ...spread(dueRows.filter((r) => !wanted(r.fact_id)), (r) => sib(r.fact_id))];
  const introducedToday = (db.prepare('SELECT COUNT(*) n FROM srs_cards WHERE user_id = ? AND introduced >= ?').get(userId, dayStart()) as any).n;
  const seen = new Set((db.prepare('SELECT fact_id FROM srs_cards WHERE user_id = ?').all(userId) as any[]).map((r) => r.fact_id));
  const ownNew = [...own.keys()].filter((id) => !seen.has(id));
  const unseen = [...ownNew, ...lead(cards.filter((c) => !seen.has(c.factId)).map((c) => c.factId), wanted)];
  const examDays = daysUntil(getGoals(userId).examDate);
  const pace = pacing(userId, examDays);
  const perDay = pace.status === 'done' ? DEFAULT_NEW : pace.perDay; // a finished deck still lets the user's own cards in
  const slice = unseen.slice(0, Math.max(0, perDay - introducedToday));
  // The user's own new cards stay first; deck cards are spread so siblings from one page don't sit back to back.
  const deckNew = slice.filter((id) => !own.has(id));
  const fresh = [...slice.filter((id) => own.has(id)), ...spread(deckNew.filter(wanted), sib), ...spread(deckNew.filter((id) => !wanted(id)), sib)];
  const custom = Object.fromEntries([...due.map((r) => r.fact_id), ...fresh].filter((id) => own.has(id)).map((id) => {
    const { front, back, factId, path } = own.get(id)!;
    return [id, { front, back, factId, path }];
  }));
  return {
    due: due.map((r) => {
      const card = JSON.parse(r.card);
      const topic = card.lapses >= LEECH ? factTopics.get(own.get(r.fact_id)?.factId ?? r.fact_id)?.[0] : undefined;
      return topic ? { factId: r.fact_id, card, topic } : { factId: r.fact_id, card };
    }),
    fresh,
    remainingNew: unseen.length,
    custom,
    retention: retentionFor(userId, examDays),
    pace,
    leech: LEECH,
  };
}

export function srsReview(userId: number, factId: string, rating: Grade, reviewedAt: number, clientId: string) {
  const n = userCardNum(factId);
  if (n ? !db.prepare('SELECT 1 FROM user_cards WHERE id = ? AND user_id = ?').get(n, userId) : !cardByFact.has(factId)) return false;
  return db.transaction(() => {
    if (clientId && db.prepare('SELECT 1 FROM srs_log WHERE client_id = ?').get(clientId)) return true; // already synced
    const row = db.prepare('SELECT card FROM srs_cards WHERE user_id = ? AND fact_id = ?').get(userId, factId) as { card: string } | undefined;
    const at = new Date(Math.min(Math.max(reviewedAt, now() - 7 * 86_400_000), now())); // offline syncs may be days late; older stamps would only fake streaks
    const prev = row ? revive(row.card) : createEmptyCard(at);
    const { card } = schedulerFor(retentionFor(userId)).next(prev, at, rating);
    db.prepare(`INSERT INTO srs_cards (user_id, fact_id, card, due, introduced) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (user_id, fact_id) DO UPDATE SET card = excluded.card, due = excluded.due`)
      .run(userId, factId, JSON.stringify(card), card.due.getTime(), at.getTime());
    db.prepare('INSERT INTO srs_log (user_id, fact_id, rating, reviewed_at, client_id) VALUES (?, ?, ?, ?, ?)').run(userId, factId, rating, at.getTime(), clientId || null);
    if (card.lapses >= LEECH && prev.lapses < LEECH) // just became a leech: it joins the weak spots (planner, Fix-it)
      db.prepare("INSERT OR IGNORE INTO marks (user_id, item_type, item_id, kind, created_at) VALUES (?, ?, ?, 'weak', ?)").run(userId, n ? 'card' : 'fact', factId, now());
    return true;
  })();
}

// ms: time on the question (null when unknown); source: where it was answered; confidence: how sure the student was.
export function recordAttempt(userId: number, qid: string, choice: string, ms: number | null = null, source: 'bank' | 'quiz' | 'exam' = 'bank', confidence: Confidence | null = null) {
  const m = mcqs.find((x) => x.qid === qid);
  if (!m || !Object.hasOwn(m.options, choice)) return null;
  const correct = m.key ? (m.key === choice ? 1 : 0) : null;
  const t = ms === null || !Number.isFinite(ms) ? null : Math.max(0, Math.min(86_400_000, Math.round(ms)));
  const conf = confidence && CONFIDENCE.includes(confidence) ? confidence : null;
  db.prepare('INSERT INTO mcq_attempts (user_id, qid, choice, correct, created_at, ms, source, confidence) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(userId, qid, choice, correct, now(), t, source, conf);
  if (correct !== null) trackMistake(userId, qid, choice, correct as 0 | 1, conf === 'guess');
  return { correct, key: m.key };
}

export type FactState = 'unseen' | 'learning' | 'strong' | 'lapsed';
/** Per-fact memory state for the reader's mastery dots. Facts without a flashcard are left out. */
export function factStates(userId: number, ids: string[]): Record<string, FactState> {
  const want = [...new Set(ids)].filter((id) => cardByFact.has(id));
  const out: Record<string, FactState> = Object.fromEntries(want.map((id) => [id, 'unseen' as FactState]));
  for (let i = 0; i < want.length; i += 500) {
    const part = want.slice(i, i + 500);
    for (const r of db.prepare(`SELECT fact_id, card FROM srs_cards WHERE user_id = ? AND fact_id IN (${part.map(() => '?').join(',')})`).all(userId, ...part) as { fact_id: string; card: string }[]) {
      const c = JSON.parse(r.card) as { state: number; lapses: number; scheduled_days: number };
      out[r.fact_id] = c.state === State.Relearning || c.lapses >= LEECH ? 'lapsed' : c.state === State.Review && c.scheduled_days >= 7 ? 'strong' : 'learning';
    }
  }
  return out;
}

/** Adds fact cards to the user's deck now, due immediately (deliberate learning: a topic, a page or highlights). */
export function learnFacts(userId: number, ids: string[]) {
  const seen = new Set((db.prepare('SELECT fact_id FROM srs_cards WHERE user_id = ?').all(userId) as { fact_id: string }[]).map((r) => r.fact_id));
  const want = [...new Set(ids)].filter((id) => cardByFact.has(id));
  const add = want.filter((id) => !seen.has(id)).slice(0, 200);
  const t = now();
  const ins = db.prepare('INSERT OR IGNORE INTO srs_cards (user_id, fact_id, card, due, introduced) VALUES (?, ?, ?, ?, ?)');
  db.transaction(() => { for (const id of add) ins.run(userId, id, JSON.stringify(createEmptyCard(new Date(t))), t, t); })();
  return { added: add.length, already: want.length - add.length, ids: want };
}

/** How many of these facts have a flashcard, and how many of those are already in the user's deck. */
export function deckStatus(userId: number, ids: string[]) {
  const withCard = [...new Set(ids)].filter((id) => cardByFact.has(id));
  if (!withCard.length) return { cards: 0, inDeck: 0 };
  const n = (db.prepare(`SELECT COUNT(*) n FROM srs_cards WHERE user_id = ? AND fact_id IN (${withCard.map(() => '?').join(',')})`).get(userId, ...withCard) as { n: number }).n;
  return { cards: withCard.length, inDeck: n };
}

export function noteVisit(userId: number, kind: string, ref: string, title: string) {
  db.prepare(`INSERT INTO visits (user_id, kind, ref, title, at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (user_id, kind, ref) DO UPDATE SET at = excluded.at, title = excluded.title`).run(userId, kind, ref, title, now());
}

/** Remembers how far down a visited page the reader got (0..1). Only for pages already in the history. */
export function savePos(userId: number, kind: string, ref: string, pos: number) {
  if (!Number.isFinite(pos)) return false;
  return db.prepare('UPDATE visits SET pos = ? WHERE user_id = ? AND kind = ? AND ref = ?').run(Math.max(0, Math.min(1, Math.round(pos * 1000) / 1000)), userId, kind, ref).changes > 0;
}

export const visitPos = (userId: number, kind: string, ref: string) =>
  (db.prepare('SELECT pos FROM visits WHERE user_id = ? AND kind = ? AND ref = ?').get(userId, kind, ref) as { pos: number | null } | undefined)?.pos ?? null;

export function dashboard(userId: number) {
  const t0 = dayStart();
  const dueNow = (db.prepare('SELECT COUNT(*) n FROM srs_cards WHERE user_id = ? AND due <= ?').get(userId, now()) as any).n as number;
  const q = srsQueue(userId);
  const reviewsToday = (db.prepare('SELECT COUNT(*) n FROM srs_log WHERE user_id = ? AND reviewed_at >= ?').get(userId, t0) as any).n as number;
  // latest attempt per question
  const mcq = db.prepare(`SELECT COUNT(*) answered, SUM(correct = 1) n_right, SUM(correct IS NOT NULL) keyed FROM mcq_attempts a
                          WHERE user_id = ? AND id = (SELECT MAX(id) FROM mcq_attempts b WHERE b.user_id = a.user_id AND b.qid = a.qid)`).get(userId) as any;
  const days = new Set([
    ...(db.prepare('SELECT reviewed_at t FROM srs_log WHERE user_id = ? AND reviewed_at > ?').all(userId, now() - 400 * 86_400_000) as any[]).map((r) => dayKey(r.t)),
    ...(db.prepare('SELECT created_at t FROM mcq_attempts WHERE user_id = ? AND created_at > ?').all(userId, now() - 400 * 86_400_000) as any[]).map((r) => dayKey(r.t)),
  ]);
  const s = liveStreak(userId, days);
  const streak = s.streak;
  const week = Array.from({ length: 14 }, (_, i) => {
    const s = t0 - (13 - i) * 86_400_000;
    const n = (db.prepare('SELECT (SELECT COUNT(*) FROM srs_log WHERE user_id = ? AND reviewed_at >= ? AND reviewed_at < ?) + (SELECT COUNT(*) FROM mcq_attempts WHERE user_id = ? AND created_at >= ? AND created_at < ?) n').get(userId, s, s + 86_400_000, userId, s, s + 86_400_000) as any).n;
    return { day: dayKey(s), n };
  });
  const seen = db.prepare('SELECT fact_id, card FROM srs_cards WHERE user_id = ?').all(userId) as { fact_id: string; card: string }[];
  const mastery: Record<string, { total: number; seen: number; strong: number }> = {};
  for (const c of cards) (mastery[factSystem.get(c.factId) || 'other'] ??= { total: 0, seen: 0, strong: 0 }).total++;
  for (const r of seen) {
    const m = mastery[factSystem.get(r.fact_id) || 'other']; if (!m) continue;
    m.seen++;
    const c = JSON.parse(r.card);
    if (c.state === State.Review && c.scheduled_days >= 7) m.strong++;
  }
  const recent = db.prepare('SELECT kind, ref, title, at, pos FROM visits WHERE user_id = ? ORDER BY at DESC LIMIT 4').all(userId) as { kind: string; ref: string; title: string; at: number; pos: number | null }[];
  return {
    dueNow, newToday: q.fresh.length, reviewsToday, streak, freezes: s.freezes, frozenRecently: s.used.length > 0 && s.used[0] >= dayKey(now() - 7 * 86_400_000), streakHeld: s.held, week, mastery, recent,
    mcqAnswered: mcq.answered ?? 0, mcqRight: mcq.n_right ?? 0, mcqKeyed: mcq.keyed ?? 0,
    cardsSeen: seen.length,
  };
}

export { Rating };
