import type { APIRoute } from 'astro';
import { deletePoll, denied, isAdmin, reply, setPollClosed } from '../../../../server/admin';
import { intId, readBody } from '../../../../server/personal';

// { closed: boolean }
export const PATCH: APIRoute = async ({ request, locals, params }) => {
  if (!isAdmin(locals.user)) return denied();
  const b = await readBody(request);
  return reply(setPollClosed(locals.user.id, intId(params.id), b?.closed));
};

export const DELETE: APIRoute = ({ locals, params }) => (isAdmin(locals.user) ? reply(deletePoll(locals.user.id, intId(params.id))) : denied());
