import type { APIRoute } from 'astro';
import { follow, isAidKind, sse, topicAid } from '../../../server/ai';
import { fail, readBody } from '../../../server/personal';
import { topicBySlug } from '../../../lib/data';

// { topic, kind: 'recap' | 'mnemonic' | 'examined', fresh?: true } -> text/event-stream. Shared and cached per topic; `fresh` (admins only) regenerates.
export const POST: APIRoute = async ({ request, locals }) => {
  const b = await readBody(request), u = locals.user!;
  if (!b || typeof b.topic !== 'string' || !topicBySlug.has(b.topic)) return fail('Unknown topic.');
  if (!isAidKind(b.kind)) return fail('Unknown study aid.');
  if (b.fresh !== undefined && typeof b.fresh !== 'boolean') return fail('Invalid request.');
  if (b.fresh && u.role !== 'admin') return fail('Only admins can regenerate study aids.', 403);
  const ac = follow(request.signal);
  return sse(topicAid(u.id, b.topic, b.kind, b.fresh === true, ac.signal), ac, { admin: u.role === 'admin' });
};
