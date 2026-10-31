import { db, now } from './db';
import { DAY, factTopics, mcqTopics, topicFacts } from './analytics';
import { factById, mcqs, topicBySlug, topics } from '../lib/data';

// Content gaps: where the class is stuck or the notes run out. Read-only aggregates for the admin "Content gaps" tab.
const NOT_COVERED = '%Not covered in Lightbox notes yet%';
const mcqById = new Map(mcqs.map((m) => [m.qid, m]));
const topicHasMcq = new Set([...mcqTopics.values()].flat());
const clip = (s: string, n = 160) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

export interface Gaps {
  uncovered: { question: string; n: number; last: number }[];
  hardMcqs: { qid: string; stem: string; tries: number; wrong: number; rate: number; href: string }[];
  leeches: { id: string; fact: string; again: number; people: number; href: string }[];
  noMcqTopics: { slug: string; title: string; href: string; readers: number; facts: number }[];
  unchecked: { id: string; fact: string; label: string; readers: number; href: string }[];
}

export function gaps(days = 60): Gaps {
  const since = now() - days * DAY;
  // Tutor questions the notes could not answer: the user message just before each "not covered" reply.
  const rows = db.prepare(`SELECT (SELECT u.content FROM ai_messages u WHERE u.chat_id = a.chat_id AND u.role = 'user' AND u.id < a.id ORDER BY u.id DESC LIMIT 1) q, a.created_at at
    FROM ai_messages a WHERE a.role = 'assistant' AND a.created_at >= ? AND a.content LIKE ?`).all(since, NOT_COVERED) as { q: string | null; at: number }[];
  const byQ = new Map<string, { question: string; n: number; last: number }>();
  for (const r of rows) {
    if (!r.q) continue;
    const k = r.q.toLowerCase().replace(/[^a-z0-9 ]+/g, ' ').replace(/\s+/g, ' ').trim();
    const e = byQ.get(k) ?? { question: clip(r.q.trim()), n: 0, last: 0 };
    e.n++; e.last = Math.max(e.last, r.at);
    byQ.set(k, e);
  }
  const uncovered = [...byQ.values()].sort((a, b) => b.n - a.n || b.last - a.last).slice(0, 20);

  // Questions most often answered wrong (latest answer per person, keyed questions only).
  const tries = db.prepare(`SELECT qid, COUNT(*) tries, SUM(correct = 0) wrong FROM (
      SELECT qid, user_id, correct FROM mcq_attempts a WHERE correct IS NOT NULL AND created_at >= ?
        AND id = (SELECT MAX(id) FROM mcq_attempts b WHERE b.user_id = a.user_id AND b.qid = a.qid))
    GROUP BY qid HAVING wrong > 0`).all(since) as { qid: string; tries: number; wrong: number }[];
  const hardMcqs = tries.filter((t) => mcqById.has(t.qid)).map((t) => ({ qid: t.qid, stem: clip(mcqById.get(t.qid)!.stem, 140), tries: t.tries, wrong: t.wrong,
    rate: Math.round((t.wrong / t.tries) * 100), href: `/practice/mcq?q=${encodeURIComponent(t.qid)}` }))
    .sort((a, b) => b.wrong - a.wrong || b.rate - a.rate).slice(0, 15);

  // Cards the class keeps forgetting.
  const again = db.prepare(`SELECT fact_id id, COUNT(*) again, COUNT(DISTINCT user_id) people FROM srs_log WHERE rating = 1 AND reviewed_at >= ?
    GROUP BY fact_id ORDER BY again DESC LIMIT 30`).all(since) as { id: string; again: number; people: number }[];
  const leeches = again.filter((r) => factById.has(r.id) && r.again >= 2).slice(0, 15)
    .map((r) => ({ ...r, fact: clip(factById.get(r.id)!.fact, 140), href: `/facts/${r.id}` }));

  // Topics people read that have no past-paper question to practise.
  const reads = new Map((db.prepare(`SELECT ref, COUNT(DISTINCT user_id) n FROM visits WHERE kind = 'topic' GROUP BY ref`).all() as { ref: string; n: number }[]).map((r) => [r.ref, r.n]));
  const readers = (slug: string) => { const t = topicBySlug.get(slug); return t ? reads.get(`/study/${t.system}/${slug}`) ?? 0 : 0; };
  const noMcqTopics = topics.filter((t) => !topicHasMcq.has(t.slug)).map((t) => ({ slug: t.slug, title: t.title, href: `/study/${t.system}/${t.slug}`, readers: readers(t.slug), facts: topicFacts.get(t.slug)?.length ?? 0 }))
    .sort((a, b) => b.readers - a.readers || b.facts - a.facts).slice(0, 15);

  // Unverified facts in the topics people read most.
  const unchecked = [...factById.values()].filter((f) => f.label === 'unchecked' || f.label === 'disputed')
    .map((f) => ({ id: f.id, fact: clip(f.fact, 140), label: f.label, readers: Math.max(0, ...(factTopics.get(f.id) ?? []).map(readers)), href: `/facts/${f.id}` }))
    .filter((f) => f.readers > 0).sort((a, b) => b.readers - a.readers).slice(0, 15);

  return { uncovered, hardMcqs, leeches, noMcqTopics, unchecked };
}
