import { describe, expect, it } from 'vitest';
import { Rating } from 'ts-fsrs';
import { changePassword, createSession, createUser, endSession, login, readSession, resetPassword, tempPassword, validatePassword, validUsername } from '../../src/server/auth';
import { db } from '../../src/server/db';
import { recordAttempt, srsQueue, srsReview } from '../../src/server/progress';
import { cards, mcqs } from '../../src/lib/data';

describe('auth', () => {
  it('validates usernames and passwords', () => {
    expect(validUsername('ayesha.amjad')).toBe(true);
    expect(validUsername('a')).toBe(false);
    expect(validUsername('bad name')).toBe(false);
    expect(validatePassword('short1')).toMatch(/10 characters/);
    expect(validatePassword('onlyletterslong')).toMatch(/Mix/);
    expect(validatePassword('good-password-1')).toBeNull();
    expect(tempPassword()).toMatch(/^[a-z2-9]{4}-[a-z2-9]{4}-[a-z2-9]{4}$/);
  });

  it('signs in, forces a password change, and ends sessions', async () => {
    const pw = await createUser(null, 'tester', 'Test User', 'member');
    expect((await login('tester', 'wrong-password-1', '1.1.1.1', ''))).toHaveProperty('error');
    const r = await login('TESTER', pw, '1.1.1.1', 'ua');
    expect(r).toHaveProperty('session');
    const token = 'session' in r ? r.session!.token : '';
    const s = readSession(token);
    expect(s?.mustChange).toBe(true);
    expect(await changePassword(s!.id, pw, 'brand-new-pass-2', s!.sessionId)).toBeNull();
    expect(readSession(token)?.mustChange).toBe(false);
    endSession(s!.sessionId);
    expect(readSession(token)).toBeNull();
  });

  it('throttles repeated failures and resets revoke sessions', async () => {
    await createUser(null, 'victim', 'Victim', 'member', 'initial-pass-9');
    for (let i = 0; i < 8; i++) await login('victim', 'nope-nope-nope', '9.9.9.9', '');
    expect(await login('victim', 'initial-pass-9', '9.9.9.9', '')).toMatchObject({ error: expect.stringMatching(/Too many/) });
    const id = (db.prepare('SELECT id FROM users WHERE username = ?').get('victim') as any).id;
    const { token } = createSession(id);
    await resetPassword(id, id);
    expect(readSession(token)).toBeNull();
  });
});

describe('progress', () => {
  const uid = () => (db.prepare('SELECT id FROM users WHERE username = ?').get('tester') as any).id as number;

  it('schedules a reviewed card and ignores duplicate offline syncs', () => {
    const id = uid(), fact = cards[0].factId;
    expect(srsQueue(id).fresh).toContain(fact);
    expect(srsReview(id, fact, Rating.Good, Date.now(), 'client-1')).toBe(true);
    expect(srsReview(id, fact, Rating.Good, Date.now(), 'client-1')).toBe(true);
    expect((db.prepare('SELECT COUNT(*) n FROM srs_log WHERE user_id = ?').get(id) as any).n).toBe(1);
    const q = srsQueue(id);
    expect(q.fresh).not.toContain(fact);
    expect(q.remainingNew).toBe(cards.length - 1);
  });

  it('marks MCQ attempts against the key', () => {
    const m = mcqs.find((x) => x.key)!;
    const wrong = Object.keys(m.options).find((k) => k !== m.key)!;
    expect(recordAttempt(uid(), m.qid, m.key)).toMatchObject({ correct: 1 });
    expect(recordAttempt(uid(), m.qid, wrong)).toMatchObject({ correct: 0 });
    expect(recordAttempt(uid(), m.qid, 'Z')).toBeNull();
  });
});
