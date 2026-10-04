import type { APIRoute } from 'astro';
import { votePoll } from '../../../../server/class';
import { fail, intId, readBody } from '../../../../server/personal';

// { choice } casts or changes your vote while the poll is open.
export const POST: APIRoute = async ({ params, request, locals }) => {
  const b = await readBody(request);
  const r = votePoll(locals.user!.id, intId(params.id), b?.choice);
  return 'error' in r ? fail(r.error, r.status) : Response.json(r);
};
