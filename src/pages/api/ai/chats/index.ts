import type { APIRoute } from 'astro';
import { createChat, listChats } from '../../../../server/ai';
import { fail, readBody } from '../../../../server/personal';

export const GET: APIRoute = ({ locals }) => Response.json(listChats(locals.user!.id), { headers: { 'cache-control': 'no-store' } });

// { title?, topic?: slug }
export const POST: APIRoute = async ({ request, locals }) => {
  const b = await readBody(request);
  if (!b) return fail('Invalid request.');
  const r = createChat(locals.user!.id, b.title, b.topic);
  return 'error' in r ? fail(r.error!) : Response.json(r);
};
