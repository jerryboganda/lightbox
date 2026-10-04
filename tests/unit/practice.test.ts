import { describe, expect, it, vi } from 'vitest';
import { createUser } from '../../src/server/auth';
import { db } from '../../src/server/db';
import { recordAttempt } from '../../src/server/progress';
import { createExam, createToacs, finish, itemsOf, load, own, parseBuild, playerItems, pool, recent, results, retake, saveAnswer, toacsStations, mcqByQid } from '../../src/server/exams';
import { matcher } from '../../src/lib/quiz';
import { factById } from '../../src/lib/data';

const user = async (name: string) => { await createUser(null, name, name, 'member'); return (db.prepare('SELECT id FROM users WHERE username = ?').get(name) as any).id as number; };
const build = (o: object) => { const b = parseBuild({ mode: 'quiz', count: 5, filters: {}, ...o }); if (typeof b === 'string') throw new Error(b); return b; };
const attempts = (uid: number, source: string) => db.prepare('SELECT qid, choice, correct, ms FROM mcq_attempts WHERE user_id = ? AND source = ?').all(uid, source) as any[];

describe('question pool', () => {
  it('keeps only answerable MCQs and gives each a known system', () => {
    expect(pool.length).toBeGreaterThan(50);
    for (const p of pool) expect(Object.keys(mcqByQid.get(p.qid)!.options).length).toBeGreaterThanOrEqual(2);
    expect(pool.filter((p) => p.system === 'other').length).toBeLessThan(pool.length / 4);
  });

  it('filters by paper, status union and history', () => {
    const mine = { answered: [pool[0].qid], wrong: [pool[0].qid], marked: [pool[1].qid] };
    expect(pool.filter(matcher({ papers: ['FEB2025'], systems: [], status: [], history: 'any' }, mine)).every((p) => p.paper === 'FEB2025')).toBe(true);
    const disputedOrNoKey = pool.filter(matcher({ papers: [], systems: [], status: ['disputed', 'nokey'], history: 'any' }, mine));
    expect(disputedOrNoKey.every((p) => p.disputed || !p.keyed)).toBe(true);
    expect(pool.filter(matcher({ papers: [], systems: [], status: [], history: 'wrong' }, mine)).map((p) => p.qid)).toEqual([pool[0].qid]);
    expect(pool.filter(matcher({ papers: [], systems: [], status: [], history: 'marked' }, mine)).map((p) => p.qid)).toEqual([pool[1].qid]);
    expect(pool.filter(matcher({ papers: [], systems: [], status: [], history: 'unanswered' }, mine))).toHaveLength(pool.length - 1);
  });
});

describe('builder input', () => {
  it('rejects bad modes, counts and timings and drops unknown filter values', () => {
    expect(parseBuild(null)).toBeTypeOf('string');
    expect(parseBuild({ mode: 'toacs', count: 5 })).toBeTypeOf('string');
    expect(parseBuild({ mode: 'quiz', count: 0 })).toBeTypeOf('string');
    expect(parseBuild({ mode: 'quiz', count: 1e6 })).toBeTypeOf('string');
    expect(parseBuild({ mode: 'exam', count: 5, perQuestion: 2 })).toBeTypeOf('string');
    expect(parseBuild({ mode: 'exam', count: 5, timing: 'total', totalMinutes: 9999 })).toBeTypeOf('string');
    const b = build({ filters: { papers: ['FEB2025', 'NOPE', 3], systems: ['chest', '<script>'], status: ['keyed', 'x'], history: 'drop table' }, title: 'a\u0000b'.repeat(60) });
    expect(b.filters).toEqual({ papers: ['FEB2025'], systems: ['chest'], status: ['keyed'], history: 'any' });
    expect(b.title.length).toBeLessThanOrEqual(80);
    expect(b.title).not.toMatch(/\u0000/);
  });
});

describe('exam sessions', () => {
  it('builds a timed exam, autosaves, and scores only keyed items at the end', async () => {
    const uid = await user('examiner');
    const id = createExam(uid, build({ mode: 'exam', count: 6, perQuestion: 60, shuffleOptions: true, filters: { papers: ['FEB2025'], status: ['keyed'] } })) as number;
    const e = own(uid, id)!;
    expect(e.time_limit).toBe(360);
    const items = itemsOf(e);
    expect(items).toHaveLength(6);
    for (const it of items) expect(it.o!.split('').sort().join('')).toBe(Object.keys(mcqByQid.get(it.q)!.options).join(''));
    // keys stay server-side while the exam runs
    expect(playerItems(e)[0]).not.toHaveProperty('key');

    const [a, b, c] = items.map((i) => mcqByQid.get(i.q)!);
    const wrong = Object.keys(b.options).find((k) => k !== b.key)!;
    expect(saveAnswer(uid, id, { item: a.qid, choice: a.key, ms: 4200, pos: 1 })).toEqual({ ok: true });
    expect(saveAnswer(uid, id, { item: a.qid, ms: 800 })).toEqual({ ok: true });
    expect(saveAnswer(uid, id, { item: b.qid, choice: wrong, flagged: true, pos: 2 })).toEqual({ ok: true });
    expect(saveAnswer(uid, id, { item: c.qid, choice: 'Z' })).toMatchObject({ status: 400 });
    expect(saveAnswer(uid, id, { item: 'NOT-IN-EXAM', choice: 'A' })).toMatchObject({ status: 400 });
    expect(JSON.parse(own(uid, id)!.config).pos).toBe(2);
    expect(attempts(uid, 'exam')).toHaveLength(0); // written once, at the end

    const done = finish(uid, id)!;
    expect(done.finished_at).toBeTruthy();
    expect(done.score).toBe(1);
    expect(done.total).toBe(6);
    const r = results(done);
    expect(r).toMatchObject({ answered: 2, right: 1, wrong: 1, unanswered: 4, flagged: 1, unscored: 0 });
    expect(r.rows[0].ms).toBe(5000);
    expect(attempts(uid, 'exam')).toEqual(expect.arrayContaining([expect.objectContaining({ qid: a.qid, correct: 1, ms: 5000 }), expect.objectContaining({ qid: b.qid, correct: 0 })]));
    expect(saveAnswer(uid, id, { item: c.qid, choice: c.key })).toMatchObject({ status: 409 });
    expect(finish(uid, id)!.score).toBe(1); // idempotent
    expect(attempts(uid, 'exam')).toHaveLength(2);

    const again = retake(uid, id) as number;
    const re = own(uid, again)!;
    expect(re.mode).toBe('quiz');
    expect(itemsOf(re).map((i) => i.q)).not.toContain(a.qid);
    expect(itemsOf(re)).toHaveLength(5);
  });

  it('gives instant feedback in practice mode and locks a checked answer', async () => {
    const uid = await user('practiser');
    const id = createExam(uid, build({ count: 3, filters: { status: ['keyed'] } })) as number;
    const q = mcqByQid.get(itemsOf(own(uid, id)!)[0].q)!;
    expect(playerItems(own(uid, id)!)[0]).toHaveProperty('key', q.key);
    expect(saveAnswer(uid, id, { item: q.qid, choice: q.key, ms: 3000 })).toEqual({ ok: true, correct: 1, key: q.key });
    expect(saveAnswer(uid, id, { item: q.qid, choice: Object.keys(q.options).find((k) => k !== q.key)! })).toMatchObject({ status: 409 });
    expect(attempts(uid, 'quiz')).toEqual([expect.objectContaining({ qid: q.qid, correct: 1, ms: 3000 })]);
    expect(finish(uid, id)).toMatchObject({ score: 1, total: 3 });
    expect(attempts(uid, 'quiz')).toHaveLength(1);
  });

  it('keeps sessions private to their owner', async () => {
    const owner = await user('owner1'), other = await user('intruder');
    const id = createExam(owner, build({ count: 2 })) as number;
    const qid = itemsOf(own(owner, id)!)[0].q;
    expect(own(other, id)).toBeUndefined();
    expect(load(other, id)).toBeNull();
    expect(saveAnswer(other, id, { item: qid, choice: 'A' })).toMatchObject({ status: 404 });
    expect(finish(other, id)).toBeNull();
    expect(retake(other, id)).toBeTypeOf('string');
    expect(recent(other)).toHaveLength(0);
    expect(recent(owner)[0]).toMatchObject({ id, n: 2, answered: 0 });
  });

  it('settles a timed exam once its deadline has passed', async () => {
    const uid = await user('latecomer');
    const id = createExam(uid, build({ mode: 'exam', count: 5, perQuestion: 15 })) as number;
    const qid = itemsOf(own(uid, id)!)[0].q;
    const real = Date.now();
    vi.spyOn(Date, 'now').mockReturnValue(real + 120_000);
    expect(recent(uid)[0].expired).toBe(true);
    expect(saveAnswer(uid, id, { item: qid, choice: 'A' })).toMatchObject({ status: 409, finished: true });
    const e = load(uid, id)!;
    expect(e.finished_at).toBe(e.started_at + 75_000);
    vi.restoreAllMocks();
  });

  it('refuses empty selections', async () => {
    const uid = await user('picky');
    expect(createExam(uid, build({ filters: { history: 'wrong' } }))).toBeTypeOf('string');
  });
});

describe('TOACS stations', () => {
  it('builds stations, grades them, scores partly as half and repeats the misses', async () => {
    const uid = await user('toacser');
    expect(createToacs(uid, 5, 45, '')).toBeTypeOf('string');
    const id = createToacs(uid, 5, 60, 'WhatsApp images') as number;
    const e = own(uid, id)!;
    expect(e.mode).toBe('toacs');
    const st = toacsStations(e);
    expect(st).toHaveLength(5);
    for (const s of st) {
      expect(s.group).toBe('WhatsApp images');
      for (const f of s.facts) expect(f.id).toMatch(/^F-/);
    }
    const [a, b, c] = st;
    expect(saveAnswer(uid, id, { item: a.file, choice: 'got', ms: 20_000 })).toEqual({ ok: true });
    expect(saveAnswer(uid, id, { item: b.file, choice: 'partial' })).toEqual({ ok: true });
    expect(saveAnswer(uid, id, { item: c.file, choice: 'A' })).toMatchObject({ status: 400 });
    expect(finish(uid, id)).toMatchObject({ score: 1.5, total: 5 });
    const again = retake(uid, id) as number;
    expect(itemsOf(own(uid, again)!).map((i) => i.q)).toEqual(st.slice(1).map((s) => s.file));
  });

  it('only shows facts from the same source file and page', async () => {
    const uid = await user('toacs2');
    const id = createToacs(uid, 30, 30, 'IMM toacs march 2026') as number;
    const st = toacsStations(own(uid, id)!);
    expect(st).toHaveLength(30);
    for (const s of st) for (const f of s.facts) expect(factById.get(f.id)).toMatchObject({ file: s.sourceFile, unit: s.page });
  });
});

describe('MCQ bank attempts', () => {
  it('records time on question and the source', async () => {
    const uid = await user('banker');
    const m = pool.find((p) => p.keyed)!;
    recordAttempt(uid, m.qid, mcqByQid.get(m.qid)!.key, 12_345);
    expect(attempts(uid, 'bank')).toEqual([expect.objectContaining({ ms: 12345, correct: 1 })]);
    expect(recordAttempt(uid, m.qid, 'toString')).toBeNull();
  });
});
