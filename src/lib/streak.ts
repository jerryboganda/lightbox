// Streaks with freezes. A single missed day between two study days is bridged by a freeze: the streak survives
// but the frozen day adds nothing. Everyone starts with one freeze and earns another at every 7 days (two at most).
export const DAY = 86_400_000;
export const FREEZE_MAX = 2;
export const FREEZE_EVERY = 7;

export interface FreezeState { freezes: number; used: string[]; earned: number }
export interface StreakResult {
  streak: number;
  /** Freezes left after this walk (new spends and milestone rewards applied). */
  freezes: number;
  /** Every frozen day, old and new, newest first, trimmed to the last 90 days. */
  used: string[];
  earned: number;
  /** Days frozen by this walk (to save). */
  spent: string[];
  /** Yesterday was missed and today has no study yet: a freeze is holding the streak, spent once today counts. */
  held: boolean;
}

export const freezeState = (p: { freezes?: number; freezeUsed?: string[]; freezeEarned?: number } | null | undefined): FreezeState => ({
  freezes: Math.max(0, Math.min(FREEZE_MAX, Number.isInteger(p?.freezes) ? p!.freezes! : 1)),
  used: Array.isArray(p?.freezeUsed) ? p!.freezeUsed!.filter((s) => typeof s === 'string') : [],
  earned: Number.isInteger(p?.freezeEarned) ? Math.max(0, p!.freezeEarned!) : 0,
});

/**
 * Counts the streak back from today (or yesterday when today has no study yet).
 * spend = false never freezes a new day (read-only views such as the leaderboard); days frozen before still bridge.
 */
export function walkStreak(isActive: (key: string) => boolean, keyOf: (t: number) => string, t: number, st: FreezeState, spend = true): StreakResult {
  const used = new Set(st.used), spent: string[] = [];
  let n = 0, avail = st.freezes, held = false;
  let d = isActive(keyOf(t)) ? t : t - DAY;
  for (let i = 0; i < 800; i++, d -= DAY) {
    const k = keyOf(d);
    if (isActive(k)) { n++; continue; }
    if (used.has(k)) continue;
    if (!isActive(keyOf(d - DAY)) || avail <= 0) break; // two missed days in a row, or no freeze left
    if (n === 0) { held = true; avail--; continue; }
    if (!spend) break;
    avail--; spent.push(k); used.add(k);
  }
  let freezes = st.freezes - spent.length, earned = Math.min(st.earned, Math.floor(n / FREEZE_EVERY));
  const reached = Math.floor(n / FREEZE_EVERY);
  if (spend && reached > earned) { freezes = Math.min(FREEZE_MAX, freezes + reached - earned); earned = reached; }
  const cutoff = keyOf(t - 90 * DAY);
  return { streak: n, freezes: Math.max(0, freezes), used: [...used].filter((k) => k >= cutoff).sort().reverse(), earned, spent, held };
}
