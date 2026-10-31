import { db, now } from './db';
import { DAY, dayStart } from './analytics';
import { mcqs } from '../lib/data';

// The mistake bank: every wrong (or right-but-guessed) keyed MCQ comes back on a spaced schedule. Answering it right
// when it is due moves it up a step; after the last step it is cleared. A miss starts it again from step 0.
export const STEPS = [1, 3, 7, 21]; // days until the next showing
export interface Mistake { qid: string; choice: string | null; reason: 'wrong' | 'guess'; step: number; misses: number; due: number; createdAt: number }
const playable = new Set(mcqs.filter((m) => m.key && Object.keys(m.options).length >= 2).map((m) => m.qid));
const dueAt = (t: number, step: number) => dayStart(t) + STEPS[Math.min(step, STEPS.length - 1)] * DAY;

export function trackMistake(uid: number, qid: string, choice: string, correct: 0 | 1, guessed = false, t = now()) {
  if (!playable.has(qid)) return;
  if (correct === 0 || guessed) {
    db.prepare(`INSERT INTO mistakes (user_id, qid, choice, reason, step, misses, due, created_at) VALUES (?, ?, ?, ?, 0, ?, ?, ?)
                ON CONFLICT (user_id, qid) DO UPDATE SET choice = excluded.choice, reason = excluded.reason, step = 0,
                misses = misses + excluded.misses, due = excluded.due, cleared_at = NULL`)
      .run(uid, qid, choice, correct === 0 ? 'wrong' : 'guess', correct === 0 ? 1 : 0, dueAt(t, 0), t);
    return;
  }
  const row = db.prepare('SELECT step, due FROM mistakes WHERE user_id = ? AND qid = ? AND cleared_at IS NULL').get(uid, qid) as { step: number; due: number } | undefined;
  if (!row || row.due > t) return; // a quick retry right after a miss does not count as remembering it
  const step = row.step + 1;
  if (step >= STEPS.length) db.prepare('UPDATE mistakes SET step = ?, cleared_at = ? WHERE user_id = ? AND qid = ?').run(step, t, uid, qid);
  else db.prepare('UPDATE mistakes SET step = ?, due = ? WHERE user_id = ? AND qid = ?').run(step, dueAt(t, step), uid, qid);
}

const COLS = 'qid, choice, reason, step, misses, due, created_at createdAt';
export const openMistakes = (uid: number) =>
  (db.prepare(`SELECT ${COLS} FROM mistakes WHERE user_id = ? AND cleared_at IS NULL ORDER BY due, created_at`).all(uid) as Mistake[]).filter((m) => playable.has(m.qid));
export const dueMistakes = (uid: number, t = now()) => openMistakes(uid).filter((m) => m.due <= t);

export function mistakeCounts(uid: number, t = now()) {
  const open = openMistakes(uid);
  const cleared = (db.prepare('SELECT COUNT(*) n FROM mistakes WHERE user_id = ? AND cleared_at IS NOT NULL').get(uid) as { n: number }).n;
  return { due: open.filter((m) => m.due <= t).length, open: open.length, cleared };
}

/** "I've got this": clears a mistake by hand. */
export const dismissMistake = (uid: number, qid: string) =>
  db.prepare('UPDATE mistakes SET cleared_at = ? WHERE user_id = ? AND qid = ? AND cleared_at IS NULL').run(now(), uid, qid).changes > 0;
