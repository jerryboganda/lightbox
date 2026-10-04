import type { APIRoute } from 'astro';
import { addHighlight, deleteHighlight, fail, intId, listHighlights, readBody, updateHighlight, validPath } from '../../server/personal';

// ?path=/study/chest/... → highlights on that page
export const GET: APIRoute = ({ locals, url }) => {
  const path = validPath(url.searchParams.get('path'));
  if (!path) return fail('Unknown page.');
  return Response.json(listHighlights(locals.user!.id, path), { headers: { 'cache-control': 'no-store' } });
};

// { path, quote, prefix, suffix, color, note?, factId? }
export const POST: APIRoute = async ({ request, locals }) => {
  const b = await readBody(request);
  const id = b && addHighlight(locals.user!.id, b);
  return id ? Response.json({ id }, { status: 201 }) : fail('Could not save this highlight.');
};

// { id, color?, note? }
export const PATCH: APIRoute = async ({ request, locals }) => {
  const b = await readBody(request);
  if (!b) return fail('Nothing to change.');
  return updateHighlight(locals.user!.id, intId(b.id), { color: b.color, note: b.note }) ? Response.json({ ok: true }) : fail('Highlight not found.', 404);
};

// ?id=
export const DELETE: APIRoute = ({ locals, url }) =>
  deleteHighlight(locals.user!.id, intId(url.searchParams.get('id'))) ? Response.json({ ok: true }) : fail('Highlight not found.', 404);
