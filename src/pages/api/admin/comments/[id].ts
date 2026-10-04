import type { APIRoute } from 'astro';
import { deleteComment, denied, hideComment, isAdmin, reply, unhideComment } from '../../../../server/admin';
import { intId, readBody } from '../../../../server/personal';

// { action: 'hide', reason } | { action: 'unhide' }
export const POST: APIRoute = async ({ request, locals, params }) => {
  if (!isAdmin(locals.user)) return denied();
  const b = await readBody(request), id = intId(params.id);
  return reply(b?.action === 'hide' ? hideComment(locals.user.id, id, b.reason) : b?.action === 'unhide' ? unhideComment(locals.user.id, id) : { error: 'Hide or unhide.' });
};

export const DELETE: APIRoute = ({ locals, params }) => (isAdmin(locals.user) ? reply(deleteComment(locals.user.id, intId(params.id))) : denied());
