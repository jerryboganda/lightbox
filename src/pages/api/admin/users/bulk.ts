import type { APIRoute } from 'astro';
import { bulkAdd, denied, isAdmin, reply } from '../../../../server/admin';
import { readBody } from '../../../../server/personal';

// { text: "username, Display Name\n..." } -> { created: [{ username, name, password }], users }
export const POST: APIRoute = async ({ request, locals }) => {
  if (!isAdmin(locals.user)) return denied();
  const b = await readBody(request);
  return reply(await bulkAdd(locals.user.id, b?.text), 201);
};
