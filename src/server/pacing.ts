import { db } from './db';
import { cards } from '../lib/data';
import { DAY, dayKey, dayStart, daysUntil, getGoals } from './analytics';

// Exam pacing: how many new flashcards a day finish the deck before the exam, leaving the last stretch for
// reviews only (14 days, or a third of the time when the exam is under four weeks away). No exam date keeps 20.
export const DEFAULT_NEW = 20;
export const PACE = { min: 5, max: 80 };

export type PaceStatus = 'none' | 'start' | 'on-track' | 'behind' | 'done';
export interface Pace {
  perDay: number; remaining: number; examDays: number | null; buffer: number;
  avg7: number; status: PaceStatus; finishBy: string | null; projectedFinish: string | null; message: string;
}

const clamp = (n: number, lo: number, hi: number) => Math.max(lo, Math.min(hi, n));

export function pacing(uid: number, examDays: number | null = daysUntil(getGoals(uid).examDate)): Pace {
  const seen = (db.prepare("SELECT COUNT(*) n FROM srs_cards WHERE user_id = ? AND fact_id NOT LIKE 'U%'").get(uid) as { n: number }).n;
  const remaining = Math.max(0, cards.length - seen);
  const t0 = dayStart();
  const week = (db.prepare("SELECT COUNT(*) n FROM srs_cards WHERE user_id = ? AND fact_id NOT LIKE 'U%' AND introduced >= ?").get(uid, t0 - 6 * DAY) as { n: number }).n;
  const avg7 = Math.round((week / 7) * 10) / 10;
  const projectedFinish = remaining && avg7 > 0 ? dayKey(t0 + Math.ceil(remaining / avg7) * DAY) : null;
  const base = { remaining, examDays, avg7, projectedFinish };

  if (!remaining) return { ...base, perDay: 0, buffer: 0, status: 'done', finishBy: null, message: 'Every flashcard is in your deck. Reviews only from here.' };
  if (examDays === null || examDays < 0)
    return { ...base, perDay: DEFAULT_NEW, buffer: 0, status: 'none', finishBy: null, message: `Set your exam date to pace ${remaining} new cards. ${DEFAULT_NEW} a day until then.` };

  const buffer = examDays > 28 ? 14 : Math.floor(examDays / 3);
  const learnDays = Math.max(1, examDays - buffer);
  const perDay = clamp(Math.ceil(remaining / learnDays), PACE.min, PACE.max);
  const finishBy = dayKey(t0 + learnDays * DAY);
  const status: PaceStatus = !seen ? 'start' : avg7 >= 0.8 * perDay ? 'on-track' : 'behind';
  const short = Math.ceil(remaining / learnDays) > PACE.max;
  const message = status === 'start' ? `${perDay} new cards a day finishes the deck by ${finishBy}, ${buffer} days before the exam.`
    : status === 'on-track' ? `On track: about ${avg7} new cards a day this week; ${perDay} a day finishes by ${finishBy}.`
    : `Behind pace: ${avg7} a day this week against ${perDay} needed to finish by ${finishBy}.`;
  return { ...base, perDay, buffer, status, finishBy, message: short ? `${message} Even ${PACE.max} a day won't cover all ${remaining}; Fix-it and high-yield topics first.` : message };
}
