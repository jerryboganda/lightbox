import type { APIRoute } from 'astro';
import { learnFacts } from '../../../server/progress';
import { topicFacts } from '../../../server/analytics';
import { allHighlights, fail, readBody } from '../../../server/personal';
import { factById, topicBySlug } from '../../../lib/data';

const squash = (s: string) => s.replace(/\s+/g, ' ').trim().toLowerCase();

/** Facts behind the user's highlights: the fact a highlight was made on, or topic bullets that contain the quote. */
function highlightFacts(uid: number) {
  const ids = new Set<string>();
  for (const h of allHighlights(uid)) {
    if (h.factId && factById.has(h.factId)) { ids.add(h.factId); continue; }
    const t = topicBySlug.get(/^\/study\/[\w-]+\/([\w-]+)/.exec(h.path)?.[1] ?? '');
    const q = squash(h.quote);
    if (!t || q.length < 4) continue;
    for (const s of t.sections) for (const b of s.bullets) if (squash(b.text).includes(q) || q.includes(squash(b.text))) b.ids.forEach((id) => ids.add(id));
  }
  return [...ids];
}

// { topic } | { factIds } | { from: 'highlights' } → adds those flashcards to the deck now.
export const POST: APIRoute = async ({ request, locals }) => {
  const b = await readBody(request);
  const uid = locals.user!.id;
  let ids: string[] | null = null;
  if (b && typeof b.topic === 'string') ids = topicFacts.get(b.topic) ?? null;
  else if (b && Array.isArray(b.factIds)) ids = b.factIds.filter((x): x is string => typeof x === 'string').slice(0, 300);
  else if (b && b.from === 'highlights') ids = highlightFacts(uid);
  if (!ids) return fail('Nothing to learn.');
  const r = learnFacts(uid, ids);
  if (!r.ids.length) return fail(b?.from === 'highlights' ? 'None of your highlights sit on a fact with a flashcard yet.' : 'No flashcards here yet.', 404);
  return Response.json({ added: r.added, already: r.already, total: r.ids.length });
};
