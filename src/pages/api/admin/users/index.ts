import type { APIRoute } from 'astro';
import { addUser, denied, isAdmin, reply } from '../../../../server/admin';
import { readBody } from '../../../../server/personal';

// { username, displayName?, role? } -> { user, password }. The temporary password travels only in this response body.
export const POST: APIRoute = async ({ request, locals }) => {
  if (!isAdmin(locals.user)) return denied();
  const b = await readBody(request);
  return reply(b ? await addUser(locals.user.id, b) : { error: 'Send a username.' }, 201);
};
