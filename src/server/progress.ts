import { createEmptyCard, fsrs, Rating, State, type Card as FCard, type Grade } from 'ts-fsrs';
import { db, now } from './db';
import { cardByFact, cards, facts, mcqs } from '../lib/data';

export const NEW_PER_DAY = 20;
const TZ_MS = 5 * 3_600_000; // Pakistan time for "today" and streaks
const scheduler = fsrs({ request_retention: 0.9, enable_fuzz: true });
const dayStart = (t = now()) => Math.floor((t + TZ_MS) / 86_400_000) * 86_400_000 - TZ_MS;
const dayKey = (t: number) => new Date(t + TZ_MS).toISOString().slice(0, 10);

const revive = (s: string): FCard => {
  const c = JSON.parse(s);
  return { ...c, due: new Date(c.due), last_review: c.last_review ? new Date(c.last_review) : undefined };
};

const factSystem = new Map(facts.map((f) => [f.id, f.system]));

// User-made cards are scheduled like fact cards under the id 'U<id>'. New ones come first and share the daily new limit.
const userCardNum = (id: string) => (/^U[1-9]\d{0,12}$/.test(id) ? Number(id.slice(1)) : 0);

export function srsQueue(userId: number) {
  const mine = db.prepare('SELECT id, front, back, fact_id factId, path FROM user_cards WHERE user_id = ? ORDER BY id').all(userId) as { id: number; front: string; back: string; factId: string | null; path: string | null }[];
  const own = new Map(mine.map((c) => [`U${c.id}`, c]));
  const due = (db.prepare('SELECT fact_id, card FROM srs_cards WHERE user_id = ? AND due <= ? ORDER BY due LIMIT 300').all(userId, now()) as { fact_id: string; card: string }[])
    .filter((r) => !r.fact_id.startsWith('U') || own.has(r.fact_id));
  const introducedToday = (db.prepare('SELECT COUNT(*) n FROM srs_cards WHERE user_id = ? AND introduced >= ?').get(userId, dayStart()) as any).n;
  const seen = new Set((db.prepare('SELECT fact_id FROM srs_cards WHERE user_id = ?').all(userId) as any[]).map((r) => r.fact_id));
  const unseen = [...[...own.keys()].filter((id) => !seen.has(id)), ...cards.filter((c) => !seen.has(c.factId)).map((c) => c.factId)];
  const fresh = unseen.slice(0, Math.max(0, NEW_PER_DAY - introducedToday));
  const custom = Object.fromEntries([...due.map((r) => r.fact_id), ...fresh].filter((id) => own.has(id)).map((id) => {
    const { front, back, factId, path } = own.get(id)!;
    return [id, { front, back, factId, path }];
  }));
  return {
    due: due.map((r) => ({ factId: r.fact_id, card: JSON.parse(r.card) })),
    fresh,
    remainingNew: unseen.length,
    custom,
  };
}

export function srsReview(userId: number, factId: string, rating: Grade, reviewedAt: number, clientId: string) {
  const n = userCardNum(factId);
  if (n ? !db.prepare('SELECT 1 FROM user_cards WHERE id = ? AND user_id = ?').get(n, userId) : !cardByFact.has(factId)) return false;
  return db.transaction(() => {
    if (clientId && db.prepare('SELECT 1 FROM srs_log WHERE client_id = ?').get(clientId)) return true; // already synced
    const row = db.prepare('SELECT card FROM srs_cards WHERE user_id = ? AND fact_id = ?').get(userId, factId) as { card: string } | undefined;
    const at = new Date(Math.min(reviewedAt, now()));
    const { card } = scheduler.next(row ? revive(row.card) : createEmptyCard(at), at, rating);
    db.prepare(`INSERT INTO srs_cards (user_id, fact_id, card, due, introduced) VALUES (?, ?, ?, ?, ?)
                ON CONFLICT (user_id, fact_id) DO UPDATE SET card = excluded.card, due = excluded.due`)
      .run(userId, factId, JSON.stringify(card), card.due.getTime(), at.getTime());
    db.prepare('INSERT INTO srs_log (user_id, fact_id, rating, reviewed_at, client_id) VALUES (?, ?, ?, ?, ?)').run(userId, factId, rating, at.getTime(), clientId || null);
    return true;
  })();
}

export function recordAttempt(userId: number, qid: string, choice: string) {
  const m = mcqs.find((x) => x.qid === qid);
  if (!m || !(choice in m.options)) return null;
  const correct = m.key ? (m.key === choice ? 1 : 0) : null;
  db.prepare('INSERT INTO mcq_attempts (user_id, qid, choice, correct, created_at) VALUES (?, ?, ?, ?, ?)').run(userId, qid, choice, correct, now());
  return { correct, key: m.key };
}

export function noteVisit(userId: number, kind: string, ref: string, title: string) {
  db.prepare(`INSERT INTO visits (user_id, kind, ref, title, at) VALUES (?, ?, ?, ?, ?)
              ON CONFLICT (user_id, kind, ref) DO UPDATE SET at = excluded.at, title = excluded.title`).run(userId, kind, ref, title, now());
}

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
  let streak = 0;
  for (let d = days.has(dayKey(now())) ? now() : now() - 86_400_000; days.has(dayKey(d)); d -= 86_400_000) streak++;
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
  const recent = db.prepare('SELECT kind, ref, title, at FROM visits WHERE user_id = ? ORDER BY at DESC LIMIT 4').all(userId) as { kind: string; ref: string; title: string; at: number }[];
  return {
    dueNow, newToday: q.fresh.length, reviewsToday, streak, week, mastery, recent,
    mcqAnswered: mcq.answered ?? 0, mcqRight: mcq.n_right ?? 0, mcqKeyed: mcq.keyed ?? 0,
    cardsSeen: seen.length,
  };
}

export { Rating };
