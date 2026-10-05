import type { APIRoute } from 'astro';
import { denied, isAdmin, reply, userAction } from '../../../../server/admin';
import { intId, readBody } from '../../../../server/personal';

// { action: 'reset' | 'toggle' | 'role' }
export const POST: APIRoute = async ({ request, locals, params }) => {
  if (!isAdmin(locals.user)) return denied();
  const b = await readBody(request);
  return reply(await userAction(locals.user, intId(params.id), b?.action));
};
