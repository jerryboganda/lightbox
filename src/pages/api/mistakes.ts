import type { APIRoute } from 'astro';
import { dismissMistake, mistakeCounts, openMistakes } from '../../server/mistakes';
import { fail } from '../../server/personal';

// The mistake bank: open mistakes (due first) and counts.
export const GET: APIRoute = ({ locals }) => {
  const uid = locals.user!.id;
  return Response.json({ items: openMistakes(uid), counts: mistakeCounts(uid), now: Date.now() }, { headers: { 'cache-control': 'no-store' } });
};

// ?qid= → "I've got this"
export const DELETE: APIRoute = ({ locals, url }) =>
  dismissMistake(locals.user!.id, String(url.searchParams.get('qid') ?? '').slice(0, 40)) ? Response.json({ ok: true }) : fail('Not in your mistake bank.', 404);
