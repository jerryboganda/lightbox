import type { APIRoute } from 'astro';
import { fail, item, listMarks, readBody, setMark } from '../../server/personal';

export const GET: APIRoute = ({ locals }) => Response.json(listMarks(locals.user!.id), { headers: { 'cache-control': 'no-store' } });

// { type, id, kind: 'bookmark' | 'weak', on: boolean }
export const POST: APIRoute = async ({ request, locals }) => {
  const uid = locals.user!.id, b = await readBody(request);
  const it = b && item(uid, b.type, b.id);
  if (!b || !it || typeof b.on !== 'boolean') return fail('Unknown item.');
  return setMark(uid, it, b.kind, b.on) ? Response.json({ ok: true }) : fail('Unknown mark.');
};
