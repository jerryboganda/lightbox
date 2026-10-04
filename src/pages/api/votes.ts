import type { APIRoute } from 'astro';
import { voteComment } from '../../server/class';
import { fail, intId, readBody } from '../../server/personal';

// { type: 'comment', id, on } → { votes, mine }
export const POST: APIRoute = async ({ request, locals }) => {
  const b = await readBody(request);
  if (!b || b.type !== 'comment' || typeof b.on !== 'boolean') return fail('Send { type: "comment", id, on }.');
  const r = voteComment(locals.user!, intId(b.id), b.on);
  return 'error' in r ? fail(r.error, r.status) : Response.json(r);
};
