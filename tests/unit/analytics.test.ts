import { beforeAll, describe, expect, it } from 'vitest';
import { Rating } from 'ts-fsrs';
import { createUser } from '../../src/server/auth';
import { db, now } from '../../src/server/db';
import { recordAttempt, srsReview } from '../../src/server/progress';
import { analytics, DAY, dayStart, getGoals, recordSession, setGoals, today } from '../../src/server/analytics';
import { cards, mcqs, topics } from '../../src/lib/data';

const mkUser = async (name: string) => { await createUser(null, name, name, 'member'); return (db.prepare('SELECT id FROM users WHERE username = ?').get(name) as any).id as number; };
const exam = (uid: number, mode: 'quiz' | 'exam' | 'toacs') =>
  Number(db.prepare("INSERT INTO exams (user_id, mode, title, config, items, started_at) VALUES (?, ?, 't', '{}', '[]', ?)").run(uid, mode, now()).lastInsertRowid);
const examAnswer = (examId: number, item: string, correct: number | null, ms = 30_000, at = now()) =>
  db.prepare('INSERT INTO exam_answers (exam_id, item_id, choice, correct, ms, answered_at) VALUES (?, ?, ?, ?, ?, ?)').run(examId, item, 'A', correct, ms, at);

let a: number, b: number, c: number;
beforeAll(async () => { a = await mkUser('alpha'); b = await mkUser('bravo'); c = await mkUser('charlie'); });

describe('goals', () => {
  it('defaults, validates bounds and saves per user', () => {
    expect(getGoals(a)).toEqual({ cards: 30, mcqs: 20, minutes: 60, examDate: null });
    expect(setGoals(a, { cards: 501, mcqs: 20, minutes: 60 })).toMatch(/Cards/);
    expect(setGoals(a, { cards: 10, mcqs: -1, minutes: 60 })).toMatch(/MCQs/);
    expect(setGoals(a, { cards: 10, mcqs: 5, minutes: 1.5 })).toMatch(/Focus minutes/);
    expect(setGoals(a, { cards: '10', mcqs: 5, minutes: 30 })).toBeTypeOf('string');
    expect(setGoals(a, { cards: 10, mcqs: 5, minutes: 721 })).toBeTypeOf('string');
    expect(setGoals(a, null)).toBeTypeOf('string');
    for (const d of ['2026-02-30', '2026-13-01', 'tomorrow', '1999-01-01', 20261201]) expect(setGoals(a, { cards: 1, mcqs: 1, minutes: 1, examDate: d })).toMatch(/Exam date/);
    expect(setGoals(a, { cards: 40, mcqs: 25, minutes: 90, examDate: '2027-03-15' })).toEqual({ cards: 40, mcqs: 25, minutes: 90, examDate: '2027-03-15' });
    expect(setGoals(a, { cards: 0, mcqs: 500, minutes: 720, examDate: '' })).toEqual({ cards: 0, mcqs: 500, minutes: 720, examDate: null });
    expect(getGoals(b).cards).toBe(30); // untouched
  });

  it('counts down to the exam date', () => {
    const d = new Date(dayStart() + 10 * DAY + 5 * 3_600_000).toISOString().slice(0, 10);
    setGoals(b, { cards: 30, mcqs: 20, minutes: 60, examDate: d });
    expect(today(b).examDays).toBe(10);
  });
});

describe('study sessions', () => {
  it('records focus time once per client id and rejects junk', () => {
    const s = { kind: 'focus', seconds: 25 * 60, startedAt: dayStart() + 1000, clientId: 'abc12345-focus-1' }; // today even just after midnight
    expect(recordSession(a, s)).toBe(true);
    expect(recordSession(a, s)).toBe(true); // retry from the outbox
    expect(recordSession(a, { ...s, kind: 'break', seconds: 300, clientId: 'abc12345-break-1' })).toBe(true);
    for (const bad of [{ ...s, kind: 'nap' }, { ...s, seconds: 0 }, { ...s, seconds: 4 * 3600 + 1 }, { ...s, seconds: 9.5 }, { ...s, startedAt: now() + 3_600_000 },
      { ...s, startedAt: now() - 8 * DAY }, { ...s, clientId: 'short' }, { ...s, clientId: 'has spaces in it' }, null, 'x']) expect(recordSession(a, bad)).toBe(false);
    expect((db.prepare('SELECT COUNT(*) n FROM study_sessions WHERE user_id = ?').get(a) as any).n).toBe(2);
    expect(today(a).done.minutes).toBe(25); // breaks do not count
  });
});

describe('today', () => {
  it('counts reviews and answers without double counting mirrored exam attempts', () => {
    srsReview(b, cards[0].factId, Rating.Good, now(), 'b-r1');
    const keyed = mcqs.find((m) => m.key)!;
    recordAttempt(b, keyed.qid, keyed.key);
    db.prepare("INSERT INTO mcq_attempts (user_id, qid, choice, correct, created_at, ms, source) VALUES (?, ?, 'A', 1, ?, 1000, 'exam')").run(b, keyed.qid, now());
    const e = exam(b, 'exam'), t = exam(b, 'toacs');
    examAnswer(e, keyed.qid, 1);
    examAnswer(t, 'station-1', null);
    expect(today(b).done).toEqual({ cards: 1, mcqs: 2, minutes: 0 });
  });
});

describe('analytics', () => {
  it('handles a brand-new user', () => {
    const r = analytics(c);
    expect(r.heatmap.weeks).toHaveLength(26);
    expect(r.heatmap.weeks.flat().every((d) => d.score === 0)).toBe(true);
    expect(r.heatmap.current).toBe(0);
    expect(r.readiness.score).toBe(0);
    expect(r.readiness.parts.find((p) => p.key === 'retention')!.value).toBeNull();
    expect(r.weak).toEqual([]);
    expect(r.reviewedCount).toBe(0);
    expect(r.trend.every((w) => w.acc === null)).toBe(true);
    expect(r.mastery.reduce((s, m) => s + m.total, 0)).toBe(cards.length);
  });

  it('builds streaks, heatmap and time from activity', () => {
    const u = a, t0 = dayStart();
    for (const d of [0, 1, 2, 5, 6, 7, 8]) db.prepare('INSERT INTO srs_log (user_id, fact_id, rating, reviewed_at) VALUES (?, ?, 3, ?)').run(u, cards[1].factId, t0 - d * DAY + 3_600_000);
    const r = analytics(u);
    expect(r.heatmap.current).toBe(3);
    expect(r.heatmap.longest).toBe(4);
    const cells = r.heatmap.weeks.flat().filter((d) => !d.future);
    const todayCell = cells[cells.length - 1];
    expect(todayCell.reviews).toBe(1);
    expect(todayCell.minutes).toBe(25);
    expect(todayCell.level).toBe(4); // the busiest day in the window
    expect(r.time[13].focus).toBe(25 * 60);
    expect(r.weekSeconds).toBeGreaterThanOrEqual(25 * 60);
    expect(r.readiness.parts.find((p) => p.key === 'consistency')!.value).toBeCloseTo(7 / 14);
  });

  it('predicts forgetting and readiness from FSRS cards', () => {
    const u = c;
    for (const card of cards.slice(0, 12)) srsReview(u, card.factId, Rating.Good, now() - 2 * DAY, `c-${card.factId}`);
    const r = analytics(u);
    expect(r.reviewedCount).toBe(12);
    expect(r.curve).toHaveLength(31);
    expect(r.curve[0].recall).toBeGreaterThan(r.curve[30].recall);
    expect(r.curve[30].recall).toBeGreaterThan(0);
    expect(r.below + r.dropping).toBeGreaterThan(0); // short first intervals fall below 90% within a week
    const ret = r.readiness.parts.find((p) => p.key === 'retention')!;
    expect(ret.value).toBeGreaterThan(0.5);
    expect(r.readiness.score).toBeGreaterThan(0);
    expect(r.mastery.reduce((s, m) => s + m.seen, 0)).toBe(12);
  });

  it('tracks weekly keyed accuracy and needs 10 answers before it counts', () => {
    const u = c, keyed = mcqs.filter((m) => m.key).slice(0, 10);
    for (const m of keyed.slice(0, 9)) recordAttempt(u, m.qid, m.key);
    expect(analytics(u).readiness.parts.find((p) => p.key === 'accuracy')!.value).toBeNull();
    const wrong = Object.keys(keyed[9].options).find((k) => k !== keyed[9].key)!;
    recordAttempt(u, keyed[9].qid, wrong);
    const r = analytics(u);
    expect(r.readiness.parts.find((p) => p.key === 'accuracy')!.value).toBeCloseTo(0.9);
    expect(r.trend[11]).toMatchObject({ n: 10, keyed: 10, right: 9 });
    expect(r.trend[11].acc).toBeCloseTo(0.9);
  });

  it('ranks weak topics from lapses, wrong MCQs and weak marks', async () => {
    const u = await mkUser('delta');
    const topic = topics.find((t) => t.sections.some((s) => s.bullets.some((b) => cards.some((c) => c.factId === b.ids[0]))))!;
    const fact = topic.sections.flatMap((s) => s.bullets.map((b) => b.ids[0])).find((id) => cards.some((c) => c.factId === id))!;
    srsReview(u, fact, Rating.Again, now() - 60_000, 'd-1');
    srsReview(u, fact, Rating.Again, now(), 'd-2');
    let w = analytics(u).weak;
    expect(w[0]).toMatchObject({ slug: topic.slug, reason: '2 Again ratings', drill: fact, href: `/study/${topic.system}/${topic.slug}` });

    const other = topics.find((t) => t.slug !== topic.slug)!;
    db.prepare("INSERT INTO marks (user_id, item_type, item_id, kind, created_at) VALUES (?, 'topic', ?, 'weak', ?)").run(u, other.slug, now());
    db.prepare("INSERT INTO marks (user_id, item_type, item_id, kind, created_at) VALUES (?, 'topic', 'no-such-topic', 'weak', ?)").run(u, now());
    w = analytics(u).weak;
    expect(w.find((x) => x.slug === other.slug)?.reason).toBe('marked weak');

    const m = mcqs.find((q) => q.key)!;
    recordAttempt(u, m.qid, Object.keys(m.options).find((k) => k !== m.key)!);
    w = analytics(u).weak;
    expect(w.some((x) => x.reason.includes('1 wrong MCQ'))).toBe(true);
    expect(w.length).toBeLessThanOrEqual(8);
    expect(analytics(b).weak.some((x) => x.slug === other.slug)).toBe(false); // other users unaffected
  });
});
