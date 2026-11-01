// The personal high-yield sheet: weak topics and the facts behind them, ranked from the caller's own evidence.
import { db } from './db';
import { DAY, weakOnly } from './analytics';
import { factById, shortFile, topicBySlug, type Fact, type Label } from '../lib/data';
import { unitWord } from '../lib/sources';

export interface SheetLine { text: string; label?: Label | null; ids: string[]; hot: boolean }
export interface SheetTopic { slug: string; title: string; systemLabel: string; href: string; reason: string; oneLiner: string; sections: { heading: string; lines: SheetLine[] }[]; hidden: number }
export interface SheetFact { fact: Fact; place: string; why: string; score: number }

const KEEP = 10;
const now = () => Date.now();
const plural = (n: number, w: string) => `${n} ${w}${n === 1 ? '' : 's'}`;

/** Facts this person struggles with: lapses, recent Again ratings and weak marks, scored like the weak-topic list. */
export function troubleFacts(uid: number) {
  const ev = new Map<string, { lapses: number; again: number; marked: boolean }>();
  const get = (id: string) => ev.get(id) ?? ev.set(id, { lapses: 0, again: 0, marked: false }).get(id)!;
  for (const r of db.prepare("SELECT fact_id id, CAST(json_extract(card, '$.lapses') AS INTEGER) n FROM srs_cards WHERE user_id = ? AND fact_id NOT LIKE 'U%' AND json_extract(card, '$.lapses') > 0")
    .all(uid) as { id: string; n: number }[]) get(r.id).lapses = r.n;
  for (const r of db.prepare('SELECT fact_id id, COUNT(*) n FROM srs_log WHERE user_id = ? AND rating = 1 AND reviewed_at >= ? GROUP BY fact_id')
    .all(uid, now() - 90 * DAY) as { id: string; n: number }[]) get(r.id).again = r.n;
  for (const r of db.prepare("SELECT item_id id FROM marks WHERE user_id = ? AND kind = 'weak' AND item_type IN ('fact', 'card')").all(uid) as { id: string }[]) get(r.id).marked = true;
  const out = new Map<string, { score: number; why: string }>();
  for (const [id, e] of ev) {
    if (!factById.has(id)) continue;
    const why = [e.lapses && plural(e.lapses, 'lapse'), e.again && plural(e.again, 'Again rating'), e.marked && 'marked weak'].filter(Boolean).join(', ');
    out.set(id, { score: 2 * e.lapses + e.again + (e.marked ? 3 : 0), why });
  }
  return out;
}

/** The sheet: up to `limit` weak topics (missed lines first, then the opening line of each section) and the most-missed facts. */
export function highYield(uid: number, limit = 12, factLimit = 30) {
  const trouble = troubleFacts(uid);
  const topics: SheetTopic[] = weakOnly(uid, limit).map((w) => {
    const t = topicBySlug.get(w.slug)!;
    const all = t.sections.flatMap((s, si) => s.bullets.map((b, bi) => ({ si, bi, heading: s.heading, line: { text: b.text, label: b.label, ids: b.ids, hot: b.ids.some((id) => trouble.has(id)) } })));
    const keep = new Set(all.filter((x) => x.line.hot).map((x) => `${x.si}.${x.bi}`));
    for (const x of all) { if (keep.size >= KEEP) break; if (x.bi === 0) keep.add(`${x.si}.${x.bi}`); }
    for (const x of all) { if (keep.size >= KEEP) break; keep.add(`${x.si}.${x.bi}`); }
    const sections: SheetTopic['sections'] = [];
    for (const x of all) {
      if (!keep.has(`${x.si}.${x.bi}`)) continue;
      const last = sections.at(-1);
      if (last && last.heading === x.heading) last.lines.push(x.line); else sections.push({ heading: x.heading, lines: [x.line] });
    }
    return { slug: w.slug, title: w.title, systemLabel: w.systemLabel, href: w.href, reason: w.reason, oneLiner: t.oneLiner, sections, hidden: all.length - keep.size };
  });
  const facts: SheetFact[] = [...trouble].sort((a, b) => b[1].score - a[1].score || a[0].localeCompare(b[0])).slice(0, factLimit).map(([id, e]) => {
    const fact = factById.get(id)!;
    return { fact, place: `${shortFile(fact.file)}, ${unitWord(fact.file).toLowerCase()} ${fact.unit}`, why: e.why, score: e.score };
  });
  return { topics, facts };
}
