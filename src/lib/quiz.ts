// Shared by the quiz builder island and src/server/exams.ts: pure, no data imports.
export type PoolItem = { qid: string; paper: string; system: string; keyed: boolean; disputed: boolean; notBlind: boolean };
export type Status = 'keyed' | 'disputed' | 'nokey' | 'notblind';
export type History = 'any' | 'unanswered' | 'wrong' | 'marked' | 'weak'; // weak = wrong or marked (preset only)
export interface Filters { papers: string[]; systems: string[]; status: Status[]; history: History }
export interface Mine { answered: string[]; wrong: string[]; marked: string[] }

export const STATUSES: [Status, string][] = [['keyed', 'Has a key'], ['disputed', 'Disputed'], ['nokey', 'No key'], ['notblind', 'Not blind']];
export const HISTORIES: [History, string][] = [['any', 'Any'], ['unanswered', 'Unanswered'], ['wrong', 'Got wrong'], ['marked', 'Bookmarked or weak']];
export const PAPERS: Record<string, string> = { FEB2025: 'IMM Feb 2025', AUG2025: 'IMM Aug 2025' };
export const VERDICT: Record<string, [string, string]> = { 'KEY CORRECT': ['s-cited', 'Key checked'], DISPUTED: ['s-disputed', 'Disputed key'], 'NO KEY': ['s-neutral', 'No key in source'], 'KEY WRONG': ['s-disputed', 'Key overruled'] };
// Badge only when it says something the key line does not: unkeyed items have no "checked key".
export const verdictBadge = (verdict: string, key: string) => (verdict === 'KEY CORRECT' && !key) || verdict === 'NO KEY' ? null : VERDICT[verdict] ?? null;
export const urls = (s: string) => s.match(/https?:\/\/[^\s;,)]+/g) || [];
export const host = (u: string) => { try { return new URL(u).hostname.replace(/^www\./, ''); } catch { return u; } };

const STATUS_TEST: Record<Status, (p: PoolItem) => boolean> = {
  keyed: (p) => p.keyed, disputed: (p) => p.disputed, nokey: (p) => !p.keyed, notblind: (p) => p.notBlind,
};

// Empty lists mean "any". Status chips are a union; history narrows.
export function matcher(f: Filters, mine: Mine) {
  const answered = new Set(mine.answered), wrong = new Set(mine.wrong), marked = new Set(mine.marked);
  return (p: PoolItem) =>
    (!f.papers.length || f.papers.includes(p.paper)) &&
    (!f.systems.length || f.systems.includes(p.system)) &&
    (!f.status.length || f.status.some((s) => STATUS_TEST[s](p))) &&
    (f.history === 'any' || (f.history === 'unanswered' && !answered.has(p.qid)) || (f.history === 'wrong' && wrong.has(p.qid)) || (f.history === 'marked' && marked.has(p.qid)) || (f.history === 'weak' && (wrong.has(p.qid) || marked.has(p.qid))));
}

export const clock = (s: number) => {
  s = Math.max(0, Math.round(s));
  const h = Math.floor(s / 3600), m = Math.floor((s % 3600) / 60), sec = s % 60;
  return (h ? `${h}:${String(m).padStart(2, '0')}` : String(m)) + ':' + String(sec).padStart(2, '0');
};

const DATE = new Intl.DateTimeFormat('en-GB', { timeZone: 'Asia/Karachi', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
export const when = (t: number) => DATE.format(t);
export const dur = (ms: number) => (ms < 59_500 ? `${Math.round(ms / 1000)} s` : clock(ms / 1000));
