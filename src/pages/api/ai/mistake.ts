import type { APIRoute } from 'astro';
import { explainMistake, follow, sse } from '../../../server/ai';
import { fail, readBody } from '../../../server/personal';

// { qid, choice, fresh?: true } -> text/event-stream. One explanation per (question, wrong option) is shared by the class.
export const POST: APIRoute = async ({ request, locals }) => {
  const b = await readBody(request), u = locals.user!;
  if (!b || typeof b.qid !== 'string' || b.qid.length > 40 || typeof b.choice !== 'string' || b.choice.length > 4) return fail('Unknown question.');
  if (b.fresh !== undefined && typeof b.fresh !== 'boolean') return fail('Invalid request.');
  if (b.fresh && u.role !== 'admin') return fail('Only admins can regenerate explanations.', 403);
  const ac = follow(request.signal);
  return sse(explainMistake(u.id, b.qid, b.choice, b.fresh === true, ac.signal), ac, { admin: u.role === 'admin' });
};
