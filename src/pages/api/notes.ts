import type { APIRoute } from 'astro';
import { fail, getNote, item, LIMITS, readBody, saveNote } from '../../server/personal';

// ?type=&id=
export const GET: APIRoute = ({ locals, url }) => {
  const it = item(locals.user!.id, url.searchParams.get('type'), url.searchParams.get('id'));
  if (!it) return fail('Unknown item.');
  return Response.json(getNote(locals.user!.id, it) ?? { body: '', updatedAt: null }, { headers: { 'cache-control': 'no-store' } });
};

// { type, id, body } — an empty body deletes the note.
export const PUT: APIRoute = async ({ request, locals }) => {
  const uid = locals.user!.id, b = await readBody(request);
  const it = b && item(uid, b.type, b.id);
  if (!b || !it) return fail('Unknown item.');
  const t = saveNote(uid, it, b.body);
  return t ? Response.json({ ok: true, updatedAt: t }) : fail(`Notes can be up to ${LIMITS.note} characters.`);
};

export const DELETE: APIRoute = ({ locals, url }) => {
  const it = item(locals.user!.id, url.searchParams.get('type'), url.searchParams.get('id'));
  if (!it) return fail('Unknown item.');
  saveNote(locals.user!.id, it, '');
  return Response.json({ ok: true });
};
