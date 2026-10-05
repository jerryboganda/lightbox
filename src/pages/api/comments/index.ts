import type { APIRoute } from 'astro';
import { postComment, thread, threadItem } from '../../../server/class';
import { fail, readBody } from '../../../server/personal';

// ?type=&id= → the whole thread for that item, oldest first.
export const GET: APIRoute = ({ locals, url }) => {
  const it = threadItem(url.searchParams.get('type'), url.searchParams.get('id'));
  if (!it) return fail('Unknown item.');
  const u = locals.user!;
  return Response.json({ ...thread(u, it), me: { name: u.displayName, admin: u.role === 'admin' } }, { headers: { 'cache-control': 'no-store' } });
};

// { type, id, body, parentId? }
export const POST: APIRoute = async ({ request, locals }) => {
  const b = await readBody(request);
  if (!b) return fail('Write something first.');
  const r = postComment(locals.user!, b);
  return 'error' in r ? fail(r.error, r.status) : Response.json(r, { status: 201 });
};
