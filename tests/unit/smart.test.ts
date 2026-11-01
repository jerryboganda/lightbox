import { afterEach, describe, expect, it, vi } from 'vitest';
import { createUser } from '../../src/server/auth';
import { db } from '../../src/server/db';
import { cards, facts, mcqs, topicBySlug } from '../../src/lib/data';
import { DAY as LDAY, FREEZE_MAX, freezeState, walkStreak } from '../../src/lib/streak';
import { frozenDays, liveStreak } from '../../src/server/streaks';
import { CHALLENGE, challengeBoard, challengeItems, challengeStatus, createFactsQuiz, finish, itemsOf, own, pickChallenge, pool, saveAnswer, startChallenge, weekEnds, weekKey, mcqByQid } from '../../src/server/exams';
import { DEFAULT_NEW, PACE, pacing } from '../../src/server/pacing';
import { grounding, NOT_COVERED } from '../../src/lib/grounding';
import { expandQuery, expansions, spellVariants } from '../../src/lib/synonyms';
import { pktMinute, PUSH, pushCount, subscribe, summary, validEndpoint } from '../../src/server/push';
import { coachGrade, isNearDuplicate, myVote, setFeedback } from '../../src/server/ai';
import { dismissMistake, dueMistakes, mistakeCounts, openMistakes, STEPS, trackMistake } from '../../src/server/mistakes';
import { DAY, dayStart } from '../../src/server/analytics';
import { highYield, troubleFacts } from '../../src/server/highyield';
import { classInsights, INSIGHT_MIN, unvotedPolls, votePoll } from '../../src/server/class';
import { learnFacts, recordAttempt } from '../../src/server/progress';
import { plan } from '../../src/server/planner';
import { goalsFor, saveOnboarding } from '../../src/server/profile';
import { clientError, resetStats } from '../../src/server/log';

const user = async (name: string) => { await createUser(null, name, name, 'member'); return (db.prepare('SELECT id FROM users WHERE username = ?').get(name) as any).id as number; };
const iso = (t: number) => new Date(t).toISOString().slice(0, 10);
const pk = (t: number) => new Date(t + 5 * 3_600_000).toISOString().slice(0, 10);
const keyed = mcqs.find((m) => m.key && Object.keys(m.options).length >= 2)!;
const wrongOf = (m: typeof keyed) => Object.keys(m.options).find((k) => k !== m.key)!;

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('streak freezes', () => {
  const T = Date.UTC(2025, 5, 15, 12);
  const walk = (days: number[], st = freezeState(null), spend = true) => {
    const on = new Set(days.map((d) => iso(T - d * LDAY)));
    return walkStreak((k) => on.has(k), iso, T, st, spend);
  };

  it('reads stored state defensively', () => {
    expect(freezeState(null)).toEqual({ freezes: 1, used: [], earned: 0 });
    expect(freezeState({ freezes: 9 }).freezes).toBe(FREEZE_MAX);
    expect(freezeState({ freezes: -3 }).freezes).toBe(0);
    expect(freezeState({ freezes: 1.5 }).freezes).toBe(1);
    expect(freezeState({ freezeUsed: ['2025-01-01', 3 as any], freezeEarned: -2 })).toEqual({ freezes: 1, used: ['2025-01-01'], earned: 0 });
  });

  it('counts unbroken days from today, or from yesterday when today is empty', () => {
    expect(walk([0, 1, 2, 3, 4])).toMatchObject({ streak: 5, freezes: 1, spent: [], held: false });
    expect(walk([1, 2, 3])).toMatchObject({ streak: 3, held: false });
  });

  it('bridges one missed day with a freeze, but never two', () => {
    expect(walk([0, 2, 3, 4])).toMatchObject({ streak: 4, freezes: 0, spent: [iso(T - LDAY)] });
    expect(walk([0, 2, 3, 4], { freezes: 0, used: [], earned: 0 })).toMatchObject({ streak: 1, spent: [] });
    expect(walk([0, 3, 4, 5])).toMatchObject({ streak: 1, freezes: 1, spent: [] });
  });

  it('read-only walks spend nothing but still honour days frozen before', () => {
    expect(walk([0, 2, 3, 4], freezeState(null), false)).toMatchObject({ streak: 1, freezes: 1, spent: [] });
    expect(walk([0, 2, 3, 4], { freezes: 0, used: [iso(T - LDAY)], earned: 0 }, false)).toMatchObject({ streak: 4, spent: [] });
  });

  it('holds the streak when yesterday was missed and today has not started, without spending', () => {
    expect(walk([2, 3])).toMatchObject({ streak: 2, held: true, freezes: 1, spent: [] });
  });

  it('earns a freeze every 7 days, capped, and only once per milestone', () => {
    const week = [0, 1, 2, 3, 4, 5, 6];
    expect(walk(week)).toMatchObject({ streak: 7, freezes: 2, earned: 1 });
    expect(walk([...week, 7, 8, 9, 10, 11, 12, 13], { freezes: 2, used: [], earned: 0 })).toMatchObject({ freezes: FREEZE_MAX, earned: 2 });
    expect(walk(week, { freezes: 1, used: [], earned: 1 })).toMatchObject({ freezes: 1, earned: 1 });
    expect(walk([0, 1], { freezes: 1, used: [], earned: 3 })).toMatchObject({ earned: 0 }); // a new streak starts over
  });

  it('keeps only the last 90 days of frozen days', () => {
    expect(walk([0], { freezes: 1, used: [iso(T - 100 * LDAY), iso(T - 10 * LDAY)], earned: 0 }).used).toEqual([iso(T - 10 * LDAY)]);
  });

  it('saves a spent freeze so later walks still bridge the day', async () => {
    const uid = await user('freezer');
    const T2 = Date.UTC(2025, 5, 15, 7);
    const active = new Set([0, 2, 3].map((d) => pk(T2 - d * DAY)));
    expect(liveStreak(uid, active, T2)).toMatchObject({ streak: 3, freezes: 0, spent: [pk(T2 - DAY)] });
    expect(frozenDays(uid).has(pk(T2 - DAY))).toBe(true);
    expect(liveStreak(uid, active, T2)).toMatchObject({ streak: 3, freezes: 0, spent: [] });
  });
});

describe('weekly challenge', () => {
  const ok = pool.filter((p) => p.keyed && !p.disputed);

  it('weeks start on Monday, Pakistan time', () => {
    const w = weekKey(Date.UTC(2025, 5, 19, 12));
    expect(new Date(w + 'T12:00:00Z').getUTCDay()).toBe(1);
    const start = Date.parse(w + 'T00:00:00+05:00');
    for (let i = 0; i < 7; i++) expect(weekKey(start + i * DAY + 3_600_000)).toBe(w);
    expect(weekKey(start - 3_600_000)).not.toBe(w);
    expect(weekKey(weekEnds(w) + 3_600_000)).not.toBe(w);
  });

  it('picks the same keyed, undisputed set for everyone, spread over systems', () => {
    const a = pickChallenge('2025-06-16', new Set());
    expect(a).toEqual(pickChallenge('2025-06-16', new Set()));
    expect(a).toHaveLength(Math.min(CHALLENGE.count, ok.length));
    expect(new Set(a).size).toBe(a.length);
    const okIds = new Set(ok.map((p) => p.qid));
    expect(a.every((q) => okIds.has(q))).toBe(true);
    const systems = new Set(ok.map((p) => p.system));
    expect(new Set(a.map((q) => ok.find((p) => p.qid === q)!.system)).size).toBe(Math.min(systems.size, a.length));
    expect(pickChallenge('2025-06-23', new Set())).not.toEqual(a);
    if (ok.length >= 2 * CHALLENGE.count) expect(pickChallenge('2025-06-23', new Set(a)).some((q) => a.includes(q))).toBe(false);
  });

  it('starts once per person per week and ranks finished attempts', async () => {
    const [u1, u2] = [await user('champ'), await user('runnerup')];
    const id = startChallenge(u1) as number;
    expect(startChallenge(u1)).toBe(id);
    const e = own(u1, id)!;
    expect(e.challenge).toBe(weekKey());
    expect(itemsOf(e).map((i) => i.q)).toEqual(challengeItems());
    expect(e.time_limit).toBe(challengeItems().length * CHALLENGE.perQuestion);
    expect(challengeStatus(u1)).toMatchObject({ mine: { id, finished: false }, players: 0 });

    const id2 = startChallenge(u2) as number;
    const qs = itemsOf(e).map((i) => mcqByQid.get(i.q)!);
    for (const m of qs.slice(0, 2)) saveAnswer(u1, id, { item: m.qid, choice: m.key! });
    saveAnswer(u2, id2, { item: qs[0].qid, choice: qs[0].key! });
    finish(u1, id); finish(u2, id2);
    const board = challengeBoard();
    expect(board.map((b) => [b.userId, b.rank, b.score])).toEqual([[u1, 1, 2], [u2, 2, 1]]);
    expect(challengeStatus(u2)).toMatchObject({ mine: { finished: true, rank: 2 }, players: 2 });
  });
});

describe('exam pacing', () => {
  it('suggests a daily number of new cards that leaves a review buffer', async () => {
    const uid = await user('pacer');
    expect(pacing(uid, null)).toMatchObject({ status: 'none', perDay: DEFAULT_NEW });
    const far = pacing(uid, 100);
    expect(far).toMatchObject({ status: 'start', buffer: 14 });
    expect(far.perDay).toBe(Math.max(PACE.min, Math.min(PACE.max, Math.ceil(cards.length / 86))));
    expect(pacing(uid, 21).buffer).toBe(7);
    expect(pacing(uid, 10).buffer).toBe(3);
    learnFacts(uid, cards.slice(0, 50).map((c) => c.factId));
    const p = pacing(uid, 100);
    expect(p.avg7).toBeGreaterThan(0);
    expect(p.status).toBe(p.avg7 >= 0.8 * p.perDay ? 'on-track' : 'behind');
  });
});

describe('grounding', () => {
  it('labels answers by their sources', () => {
    expect(grounding('anything', 2)).toBe('grounded');
    expect(grounding(`Sorry. ${NOT_COVERED.toUpperCase()}.`, 0)).toBe('not-covered');
    expect(grounding('Trust me.', 0)).toBe('unsourced');
  });
});

describe('search synonyms', () => {
  it('maps British and American spellings both ways without touching look-alikes', () => {
    expect(spellVariants('haemorrhage')).toContain('hemorrhage');
    expect(spellVariants('hemorrhage')).toContain('haemorrhage');
    expect(spellVariants('tumor')).toContain('tumour');
    expect(spellVariants('fetus')).toContain('foetus');
    expect(spellVariants('hemisphere')).toEqual([]);
    expect(spellVariants('fetch')).toEqual([]);
  });

  it('expands abbreviations, treating two-letter ones as such only in capitals', () => {
    expect(expansions('RML collapse')).toContain('right middle lobe');
    expect(expansions('PE')).toContain('pulmonary embolism');
    expect(expansions('pe')).not.toContain('pulmonary embolism');
    expect(expansions('pulmonary embolism')).toContain('pe');
    expect(expansions('PE pulmonary embolism')).toEqual([]);
    expect(expandQuery('zzz qqq')).toBe('zzz qqq');
  });
});

describe('push reminders', () => {
  it('accepts only real push services over plain https', () => {
    for (const ok of ['https://fcm.googleapis.com/fcm/send/abc', 'https://updates.push.services.mozilla.com/wpush/v2/x', 'https://db5p.notify.windows.com/w/?token=1', 'https://web.push.apple.com/abc'])
      expect(validEndpoint(ok)).toBe(true);
    for (const bad of ['http://fcm.googleapis.com/x', 'https://fcm.googleapis.com:8443/x', 'https://u:p@fcm.googleapis.com/x', 'https://fcm.googleapis.com.evil.io/x',
      'https://169.254.169.254/latest', 'https://fcm.googleapis.com/' + 'a'.repeat(1000), 42, null, 'not a url'])
      expect(validEndpoint(bad)).toBe(false);
  });

  it('validates subscriptions and keeps a few per member', async () => {
    const uid = await user('pusher');
    const keys = { p256dh: 'BKey', auth: 'auth' };
    expect(subscribe(uid, { endpoint: 'https://evil.example/x', keys })).toBeTypeOf('string');
    expect(subscribe(uid, { endpoint: 'https://fcm.googleapis.com/fcm/send/0' })).toBeTypeOf('string');
    for (let i = 0; i < PUSH.perUser + 2; i++) expect(subscribe(uid, { endpoint: `https://fcm.googleapis.com/fcm/send/${i}`, keys })).toBeNull();
    expect(pushCount(uid)).toBe(PUSH.perUser);
  });

  it('summarises what is waiting', async () => {
    const uid = await user('reminded');
    expect(summary(uid)).toMatchObject({ due: 0, mistakes: 0, title: 'Time to study', url: '/' });
    learnFacts(uid, cards.slice(0, 3).map((c) => c.factId));
    expect(summary(uid)).toMatchObject({ due: 3, title: '3 cards ready for review', url: '/practice/cards' });
    expect(pktMinute(Date.UTC(2025, 0, 1, 0, 0))).toBe(300);
    expect(pktMinute(Date.UTC(2025, 0, 1, 19, 0))).toBe(0);
  });
});

describe('AI coach and feedback', () => {
  it('reads the suggested grade line', () => {
    expect(coachGrade('**Suggested grade:** Got it.\n**You got:** ...')).toBe('got');
    expect(coachGrade('Suggested grade: Partly - you got the main sign')).toBe('partial');
    expect(coachGrade('suggested grade: Missed')).toBe('missed');
    expect(coachGrade('Suggested grade: Not yet')).toBe('missed');
    expect(coachGrade('No grade here, you got it')).toBeNull();
  });

  it('stores one validated vote per answer and clears it with 0', async () => {
    const uid = await user('voter');
    const f = facts[0].id, slug = [...topicBySlug.keys()][0];
    expect(setFeedback(uid, 'nope', f, 1)).toBe('Unknown kind.');
    expect(setFeedback(uid, 'explain', 'NOT-A-FACT', 1)).toBe('Unknown answer.');
    expect(setFeedback(uid, 'explain', f, 2)).toBeTypeOf('string');
    expect(setFeedback(uid, 'explain', f, 1)).toBeNull();
    expect(myVote(uid, 'explain', f)).toBe(1);
    expect(setFeedback(uid, 'explain', f, -1)).toBeNull();
    expect(myVote(uid, 'explain', f)).toBe(-1);
    expect(setFeedback(uid, 'explain', f, 0)).toBeNull();
    expect(myVote(uid, 'explain', f)).toBe(0);
    expect(setFeedback(uid, 'mistake', `${keyed.qid}:${wrongOf(keyed)}`, 1)).toBeNull();
    expect(setFeedback(uid, 'mistake', `${keyed.qid}:Z`, 1)).toBe('Unknown answer.');
    expect(setFeedback(uid, 'aid', `${slug}:recap`, 1)).toBeNull();
    expect(setFeedback(uid, 'aid', `${slug}:poem`, 1)).toBe('Unknown answer.');
    expect(setFeedback(uid, 'coach', '12:Chest X-ray', 1)).toBeNull();
    expect(setFeedback(uid, 'tutor', '999999', 1)).toBe('Unknown answer.');
  });

  it('spots near-duplicate stems', () => {
    const bank = [new Set(['loss', 'right', 'heart', 'border', 'middle', 'lobe', 'collapse'])];
    expect(isNearDuplicate('Loss of the right heart border in middle lobe collapse', bank)).toBe(true);
    expect(isNearDuplicate('Most common cause of a ring-enhancing brain lesion in adults', bank)).toBe(false);
  });

  it('builds a short quiz from the facts a tutor answer cited', async () => {
    const uid = await user('quizzed');
    expect(createFactsQuiz(uid, ['NOT-A-FACT'])).toBeTypeOf('string');
    let id: number | string = 'none';
    for (const f of facts.filter((x) => x.topics.length).slice(0, 400)) if (typeof (id = createFactsQuiz(uid, [f.id])) === 'number') break;
    expect(id).toBeTypeOf('number');
    const e = own(uid, id as number)!;
    expect(e.title).toMatch(/^Tutor quiz · /);
    expect(itemsOf(e).length).toBeGreaterThan(0);
    expect(itemsOf(e).length).toBeLessThanOrEqual(5);
  });
});

describe('mistake bank', () => {
  it('brings misses back on a 1-3-7-21 day schedule and clears them after the last step', async () => {
    const uid = await user('mistaken');
    const t0 = Date.UTC(2025, 5, 2, 7);
    trackMistake(uid, 'NOT-A-QID', 'A', 0, false, t0);
    trackMistake(uid, keyed.qid, wrongOf(keyed), 0, false, t0);
    expect(openMistakes(uid)).toMatchObject([{ qid: keyed.qid, reason: 'wrong', step: 0, misses: 1, due: dayStart(t0) + STEPS[0] * DAY }]);
    expect(dueMistakes(uid, t0)).toHaveLength(0);
    trackMistake(uid, keyed.qid, keyed.key!, 1, false, t0 + 60_000); // straight retry: too soon to count
    expect(openMistakes(uid)[0].step).toBe(0);
    let t = t0;
    for (let s = 1; s < STEPS.length; s++) {
      t = openMistakes(uid)[0].due + 3_600_000;
      expect(dueMistakes(uid, t)).toHaveLength(1);
      trackMistake(uid, keyed.qid, keyed.key!, 1, false, t);
      expect(openMistakes(uid)[0]).toMatchObject({ step: s, due: dayStart(t) + STEPS[s] * DAY });
    }
    trackMistake(uid, keyed.qid, keyed.key!, 1, false, openMistakes(uid)[0].due + 3_600_000);
    expect(mistakeCounts(uid, t)).toEqual({ due: 0, open: 0, cleared: 1 });
  });

  it('tracks lucky guesses, resets on a miss and can be dismissed', async () => {
    const uid = await user('guesser');
    const t0 = Date.UTC(2025, 5, 2, 7);
    trackMistake(uid, keyed.qid, keyed.key!, 1, true, t0);
    expect(openMistakes(uid)[0]).toMatchObject({ reason: 'guess', misses: 0, step: 0 });
    const t1 = openMistakes(uid)[0].due + 1;
    trackMistake(uid, keyed.qid, keyed.key!, 1, false, t1);
    expect(openMistakes(uid)[0].step).toBe(1);
    trackMistake(uid, keyed.qid, wrongOf(keyed), 0, false, t1 + 1);
    expect(openMistakes(uid)[0]).toMatchObject({ reason: 'wrong', misses: 1, step: 0 });
    expect(dismissMistake(uid, keyed.qid)).toBe(true);
    expect(dismissMistake(uid, keyed.qid)).toBe(false);
    expect(openMistakes(uid)).toEqual([]);
  });
});

describe('high-yield sheet', () => {
  it('ranks the facts you struggle with from your own evidence', async () => {
    const uid = await user('highyield');
    expect(troubleFacts(uid).size).toBe(0);
    expect(highYield(uid)).toEqual({ topics: [], facts: [] });
    const [a, b, c] = facts.map((f) => f.id).filter((id) => !id.startsWith('U'));
    const t = Date.now();
    db.prepare('INSERT INTO srs_cards (user_id, fact_id, card, due, introduced) VALUES (?, ?, ?, ?, ?)').run(uid, a, JSON.stringify({ lapses: 2 }), t, t);
    for (let i = 0; i < 2; i++) db.prepare('INSERT INTO srs_log (user_id, fact_id, rating, reviewed_at) VALUES (?, ?, 1, ?)').run(uid, b, t);
    db.prepare("INSERT INTO marks (user_id, item_type, item_id, kind, created_at) VALUES (?, 'fact', ?, 'weak', ?)").run(uid, c, t);
    const tr = troubleFacts(uid);
    expect(tr.get(a)).toEqual({ score: 4, why: '2 lapses' });
    expect(tr.get(b)).toEqual({ score: 2, why: '2 Again ratings' });
    expect(tr.get(c)).toEqual({ score: 3, why: 'marked weak' });
    const hy = highYield(uid);
    expect(hy.facts.map((f) => f.fact.id)).toEqual([a, c, b]);
    for (const tp of hy.topics) expect(tp.sections.flatMap((s) => s.lines).length).toBeLessThanOrEqual(10);
  });
});

describe('class polls and insights', () => {
  it('counts open polls you have not voted in', async () => {
    const uid = await user('pollster');
    const before = unvotedPolls(uid);
    const id = Number(db.prepare("INSERT INTO polls (item_type, question, options, created_at) VALUES ('custom', 'Which?', ?, ?)").run(JSON.stringify({ A: 'One', B: 'Two' }), Date.now()).lastInsertRowid);
    expect(unvotedPolls(uid)).toBe(before + 1);
    votePoll(uid, id, 'A');
    expect(unvotedPolls(uid)).toBe(before);
  });

  it(`shows a commonly missed question only once ${INSIGHT_MIN} people missed it, and never names them`, async () => {
    vi.useFakeTimers({ toFake: ['Date'], now: Date.now() });
    const m = mcqs.find((x) => x.key && Object.keys(x.options).length >= 2 && !db.prepare('SELECT 1 FROM mcq_attempts WHERE qid = ?').get(x.qid))!;
    const people = [await user('insight_a'), await user('insight_b'), await user('insight_c')];
    for (const u of people.slice(0, INSIGHT_MIN - 1)) recordAttempt(u, m.qid, wrongOf(m));
    expect(classInsights().missed.some((x) => x.qid === m.qid)).toBe(false);
    recordAttempt(people[INSIGHT_MIN - 1], m.qid, wrongOf(m));
    vi.setSystemTime(Date.now() + 6 * 60_000); // past the 5-minute cache
    const ins = classInsights();
    expect(ins.missed.find((x) => x.qid === m.qid)).toMatchObject({ pct: 100, people: INSIGHT_MIN, trap: { key: wrongOf(m), pct: 100 } });
    for (const tp of ins.topics) expect(tp.people).toBeGreaterThanOrEqual(INSIGHT_MIN);
    expect(JSON.stringify(ins)).not.toMatch(/insight_[abc]/);
  });
});

describe('today plan and onboarding', () => {
  it('fits steps into the time budget', async () => {
    const uid = await user('planner');
    for (const [ask, want] of [[5, 10], [1000, 240], [NaN, 30]]) expect(plan(uid, ask).minutes).toBe(want);
    learnFacts(uid, cards.slice(0, 20).map((c) => c.factId));
    const p = plan(uid, 30);
    expect(p.steps[0].kind).toBe('review');
    expect(p.used).toBe(p.steps.reduce((s, x) => s + x.minutes, 0));
    expect(p.used).toBeLessThanOrEqual(30);
    expect(new Set(p.steps.map((s) => s.id)).size).toBe(p.steps.length);
  });

  it('validates the setup wizard and derives daily goals from the budget', async () => {
    const uid = await user('newbie');
    expect(goalsFor(10)).toEqual({ cards: 10, mcqs: 5, minutes: 10 });
    expect(goalsFor(240)).toEqual({ cards: 180, mcqs: 80, minutes: 240 });
    for (const bad of [{ minutes: 5 }, { minutes: 30.5 }, { minutes: 30, confidence: [] }, { minutes: 30, confidence: { chest: 6 } }, { minutes: 30, examDate: 'soon' }])
      expect(saveOnboarding(uid, bad)).toBeTypeOf('string');
    const exam = new Date(Date.now() + 60 * DAY).toISOString().slice(0, 10);
    const r = saveOnboarding(uid, { minutes: 30, confidence: { chest: 2, nope: 5 }, examDate: exam });
    expect(r).toMatchObject({ profile: { minutes: 30, onboarded: true, confidence: { chest: 2 } }, goals: { ...goalsFor(30), examDate: exam } });
  });
});

describe('client error beacon', () => {
  it('ignores empty reports and rate-limits each member', () => {
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    resetStats();
    expect(clientError(1, {})).toBe(false);
    for (let i = 0; i < 10; i++) expect(clientError(1, { message: 'boom', url: '/x' })).toBe(true);
    expect(clientError(1, { message: 'boom' })).toBe(false);
    expect(clientError(2, { message: 'boom' })).toBe(true);
  });
});
