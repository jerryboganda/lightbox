import { db, now } from './db';
import { daysUntil, getGoals, setGoals, type Goals } from './analytics';
import { SYSTEMS, systemOrder } from '../lib/data';

// First-login setup and study preferences. Goals (exam date, daily targets) stay in `goals`; this adds the
// daily study budget, a 1-5 self-rating per system (seeds the planner before there is any history) and FSRS retention.
export interface Profile { minutes: number; confidence: Record<string, number>; retention: number; onboarded: boolean; prefs: Prefs }
export interface Prefs { remindAt?: number; freezes?: number; freezeUsed?: string[]; freezeEarned?: number }
export const MINUTES = { min: 10, max: 240 };
export const RETENTION = { min: 0.8, max: 0.97, default: 0.9 };

const parse = <T>(s: string, d: T): T => { try { const v = JSON.parse(s); return v && typeof v === 'object' ? v : d; } catch { return d; } };

export function getProfile(uid: number): Profile {
  const r = db.prepare('SELECT minutes, confidence, retention, prefs, onboarded_at FROM profiles WHERE user_id = ?').get(uid) as
    { minutes: number; confidence: string; retention: number; prefs: string; onboarded_at: number | null } | undefined;
  return r ? { minutes: r.minutes, confidence: parse(r.confidence, {}), retention: r.retention, onboarded: r.onboarded_at !== null, prefs: parse(r.prefs, {}) }
    : { minutes: 30, confidence: {}, retention: RETENTION.default, onboarded: false, prefs: {} };
}

const upsert = (uid: number, p: Profile, onboarded: boolean) =>
  db.prepare(`INSERT INTO profiles (user_id, minutes, confidence, retention, prefs, onboarded_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
              ON CONFLICT (user_id) DO UPDATE SET minutes = excluded.minutes, confidence = excluded.confidence, retention = excluded.retention,
              prefs = excluded.prefs, onboarded_at = COALESCE(profiles.onboarded_at, excluded.onboarded_at), updated_at = excluded.updated_at`)
    .run(uid, p.minutes, JSON.stringify(p.confidence), p.retention, JSON.stringify(p.prefs), onboarded ? now() : null, now());

/** Daily targets that fit a study budget: about 0.75 cards and a third of an MCQ per minute. */
export const goalsFor = (minutes: number) => ({ cards: Math.max(10, Math.min(300, Math.round(minutes * 0.75))), mcqs: Math.max(5, Math.min(120, Math.round(minutes / 3))), minutes });

/** Validates the wizard ({ examDate, minutes, confidence }) and saves profile + goals; returns an error message on bad input. */
export function saveOnboarding(uid: number, body: unknown): { profile: Profile; goals: Goals } | string {
  const b = (body && typeof body === 'object' ? body : {}) as Record<string, unknown>;
  const minutes = b.minutes;
  if (typeof minutes !== 'number' || !Number.isInteger(minutes) || minutes < MINUTES.min || minutes > MINUTES.max) return `Study time must be ${MINUTES.min} to ${MINUTES.max} minutes a day.`;
  const conf: Record<string, number> = {};
  const c = b.confidence;
  if (c !== undefined && (typeof c !== 'object' || c === null || Array.isArray(c))) return 'Confidence must be a rating per system.';
  for (const [k, v] of Object.entries((c ?? {}) as Record<string, unknown>)) {
    if (!(k in SYSTEMS)) continue;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1 || v > 5) return 'Rate each system from 1 to 5.';
    conf[k] = v;
  }
  const goals = setGoals(uid, { ...goalsFor(minutes), examDate: b.examDate ?? null });
  if (typeof goals === 'string') return goals;
  const p = getProfile(uid);
  upsert(uid, { ...p, minutes, confidence: conf }, true);
  return { profile: getProfile(uid), goals };
}

export const skipOnboarding = (uid: number) => { upsert(uid, getProfile(uid), true); return getProfile(uid); };

/** Desired retention for FSRS: the user's setting, raised to at least 0.93 in the last 14 days before the exam. */
export function retentionFor(uid: number, examDays: number | null = null) {
  const base = getProfile(uid).retention;
  const days = examDays ?? daysUntil(getGoals(uid).examDate);
  return days !== null && days >= 0 && days <= 14 ? Math.max(base, 0.93) : base;
}

export function setRetention(uid: number, value: unknown) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value < RETENTION.min || value > RETENTION.max) return `Retention must be between ${RETENTION.min * 100}% and ${RETENTION.max * 100}%.`;
  const p = getProfile(uid);
  upsert(uid, { ...p, retention: Math.round(value * 100) / 100 }, p.onboarded);
  return getProfile(uid);
}

export function setPrefs(uid: number, patch: Partial<Prefs>) {
  const p = getProfile(uid);
  upsert(uid, { ...p, prefs: { ...p.prefs, ...patch } }, p.onboarded);
  return getProfile(uid).prefs;
}

/** Systems ordered weakest first by self-rating (unrated systems sit in the middle at 3). */
export const byConfidence = (p: Profile) => [...systemOrder].sort((a, b) => (p.confidence[a] ?? 3) - (p.confidence[b] ?? 3));
