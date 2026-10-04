import type { APIRoute } from 'astro';
import { announce, denied, isAdmin, reply } from '../../../../server/admin';
import { readBody } from '../../../../server/personal';

// { body, notify?: boolean }
export const POST: APIRoute = async ({ request, locals }) => {
  if (!isAdmin(locals.user)) return denied();
  const b = await readBody(request);
  return reply(announce(locals.user.id, b?.body, b?.notify), 201);
};
