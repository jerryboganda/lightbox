import type { APIRoute } from 'astro';
import { aiFail, generateMcqs } from '../../../server/ai';
import { fail, readBody } from '../../../server/personal';

// { topicSlug?: string, factIds?: string[], n: 1..5 } -> pending questions for admin review.
export const POST: APIRoute = async ({ request, locals }) => {
  const b = await readBody(request);
  if (!b) return fail('Invalid request.');
  try {
    return Response.json(await generateMcqs(locals.user!.id, { topicSlug: b.topicSlug, factIds: b.factIds, n: b.n }, request.signal));
  } catch (e) { return aiFail(e); }
};
