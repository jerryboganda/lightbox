import type { APIRoute } from 'astro';
import { explainFact, follow, sse } from '../../../server/ai';
import { fail, readBody } from '../../../server/personal';

// { factId, fresh?: true } -> text/event-stream. `fresh` (admins only) regenerates the shared cached explanation.
export const POST: APIRoute = async ({ request, locals }) => {
  const b = await readBody(request), u = locals.user!;
  if (!b || typeof b.factId !== 'string' || b.factId.length > 40) return fail('Unknown fact.');
  if (b.fresh !== undefined && typeof b.fresh !== 'boolean') return fail('Invalid request.');
  if (b.fresh && u.role !== 'admin') return fail('Only admins can regenerate explanations.', 403);
  const ac = follow(request.signal);
  return sse(explainFact(u.id, b.factId, b.fresh === true, ac.signal), ac, { admin: u.role === 'admin' });
};
