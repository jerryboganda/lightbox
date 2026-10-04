import { cardByFact, factById, facts, mcqs, topicBySlug, topics, type Fact, type Mcq, type Topic } from '../lib/data';
import { mcqStem } from '../lib/sources';

export const MAX_COMPARE = 4;
const byTitle = new Map(topics.map((t) => [t.title.toLowerCase(), t]));

/** ?t=slug1,slug2 (+ optional ?add=slug-or-exact-title from the no-JS picker) -> known topics, deduped, at most 4. */
export function parseCompare(t: string | null, add?: string | null): Topic[] {
  const want = (t ?? '').slice(0, 600).split(',').map((s) => s.trim()).filter(Boolean);
  const extra = (add ?? '').trim().slice(0, 200);
  if (extra) want.push(topicBySlug.has(extra) ? extra : byTitle.get(extra.toLowerCase())?.slug ?? '');
  return [...new Set(want)].map((s) => topicBySlug.get(s)).filter((x): x is Topic => !!x).slice(0, MAX_COMPARE);
}

// Section order for the comparison: key points first, open questions last; ties keep first appearance.
const rank = (h: string) => (h.startsWith('Key points') ? 0 : h === 'Differentials' ? 1 : h === 'Numbers' ? 2 : h === 'MCQ traps' ? 3 : h.startsWith('Unconfirmed') ? 5 : 4);

export function alignSections(ts: Topic[]) {
  const heads: string[] = [];
  for (const t of ts) for (const s of t.sections) if (!heads.includes(s.heading)) heads.push(s.heading);
  return heads.sort((a, b) => rank(a) - rank(b)).map((heading) => ({
    heading,
    cells: ts.map((t) => t.sections.filter((s) => s.heading === heading).flatMap((s) => s.bullets)),
  }));
}

const factIds = (t: Topic) => [...new Set(t.sections.flatMap((s) => s.bullets.flatMap((b) => b.ids)))];
const pagesOf = (t: Topic) => new Set(factIds(t).map((id) => factById.get(id)).filter((f): f is Fact => !!f).map((f) => `${f.file}|${f.unit}`));
const words = (t: Topic) => new Set(`${t.title} ${t.oneLiner}`.toLowerCase().match(/[a-z]{4,}/g) ?? []);

/** Topics in the same system worth comparing: shared source pages count double, then shared title words, then title order. */
export function compareWith(t: Topic, n = 3) {
  const p = pagesOf(t), w = words(t);
  return topics.filter((x) => x.system === t.system && x.slug !== t.slug)
    .map((x) => ({ x, s: 2 * [...pagesOf(x)].filter((k) => p.has(k)).length + [...words(x)].filter((k) => w.has(k)).length }))
    .sort((a, b) => b.s - a.s || a.x.title.localeCompare(b.x.title))
    .slice(0, n).map((r) => r.x);
}

/** The MCQ player only shows questions with options; ?q= for any other qid would open the wrong question. */
export const inPlayer = (m: Mcq) => Object.keys(m.options).length >= 2;

export const mcqsOnPage = (file: string, unit: number) => {
  const stem = mcqStem(file) + '__u';
  return mcqs.filter((m) => m.unit === unit && m.file.startsWith(stem));
};

/** Everything the fact page shows around one fact. */
export function factContext(f: Fact) {
  const i = facts.indexOf(f);
  const samePage = facts.filter((x) => x !== f && x.file === f.file && x.unit === f.unit);
  return {
    prev: facts[i - 1] as Fact | undefined,
    next: facts[i + 1] as Fact | undefined,
    topics: f.topics.map((s) => topicBySlug.get(s)).filter((x): x is Topic => !!x),
    samePage,
    sameTopic: facts.filter((x) => x !== f && !samePage.includes(x) && x.topics.some((s) => f.topics.includes(s))).slice(0, 6),
    mcqs: mcqsOnPage(f.file, f.unit),
    card: cardByFact.get(f.id),
  };
}

export const differentials = facts.filter((f) => f.kind === 'differential');

/** Ready-made comparisons for an empty picker: notes with a Differentials section, each with its closest sibling, one per system first. */
export function starterPairs(n = 6) {
  const seen = new Set<string>();
  const pairs = topics.filter((t) => t.sections.some((s) => s.heading === 'Differentials'))
    .map((t) => [t, compareWith(t, 1)[0]] as const).filter((p): p is readonly [Topic, Topic] => !!p[1]);
  const first = pairs.filter(([t]) => !seen.has(t.system) && seen.add(t.system));
  return [...first, ...pairs.filter((p) => !first.includes(p))].slice(0, n);
}
