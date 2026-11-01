import { db, now } from './db';
import { freezeState, walkStreak, type StreakResult } from '../lib/streak';

// Streak freezes live in profiles.prefs. Raw SQL here (not profile.ts) because profile.ts imports analytics,
// and analytics reads frozen days from this module.
const TZ_MS = 5 * 3_600_000;
const keyOf = (t: number) => new Date(t + TZ_MS).toISOString().slice(0, 10);

const prefsOf = (uid: number) => {
  const raw = (db.prepare('SELECT prefs FROM profiles WHERE user_id = ?').get(uid) as { prefs: string } | undefined)?.prefs;
  try { const v = JSON.parse(raw ?? '{}'); return v && typeof v === 'object' ? v as Record<string, unknown> : {}; } catch { return {}; }
};

/** Days already bridged by a freeze (read-only; for analytics and the leaderboard). */
export const frozenDays = (uid: number) => new Set(freezeState(prefsOf(uid) as any).used);

/** All members' frozen days at once, for the leaderboard. */
export function frozenByUser() {
  const out = new Map<number, Set<string>>();
  for (const r of db.prepare("SELECT user_id id, prefs FROM profiles WHERE prefs LIKE '%freezeUsed%'").all() as { id: number; prefs: string }[]) {
    try { out.set(r.id, new Set(freezeState(JSON.parse(r.prefs)).used)); } catch { /* bad prefs: no freezes */ }
  }
  return out;
}

/** The streak for a set of active day keys; spends a freeze on a single missed day and saves the result. */
export function liveStreak(uid: number, active: Set<string>, t = now()): StreakResult {
  const p = prefsOf(uid), st = freezeState(p as any);
  const r = walkStreak((k) => active.has(k), keyOf, t, st);
  if (r.freezes !== st.freezes || r.earned !== st.earned || r.spent.length || r.used.length !== st.used.length) {
    const prefs = JSON.stringify({ ...p, freezes: r.freezes, freezeUsed: r.used, freezeEarned: r.earned });
    db.prepare(`INSERT INTO profiles (user_id, prefs, updated_at) VALUES (?, ?, ?)
                ON CONFLICT (user_id) DO UPDATE SET prefs = excluded.prefs, updated_at = excluded.updated_at`).run(uid, prefs, t);
  }
  return r;
}
