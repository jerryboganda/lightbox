import type { APIRoute } from 'astro';
import { createCollection, fail, item, listCollections, readBody, setCollectionItem } from '../../../server/personal';

// ?type=&id= adds a `has` flag per collection for that item.
export const GET: APIRoute = ({ locals, url }) => {
  const uid = locals.user!.id, t = url.searchParams.get('type');
  const it = t ? item(uid, t, url.searchParams.get('id'), false) : null;
  if (t && !it) return fail('Unknown item.');
  return Response.json(listCollections(uid, it), { headers: { 'cache-control': 'no-store' } });
};

// { name, description?, item?: { type, id } }
export const POST: APIRoute = async ({ request, locals }) => {
  const uid = locals.user!.id, b = await readBody(request);
  if (!b) return fail('Send a name.');
  const it = b.item && typeof b.item === 'object' ? item(uid, (b.item as any).type, (b.item as any).id, false) : null;
  if (b.item && !it) return fail('Unknown item.');
  const made = createCollection(uid, b.name, b.description);
  if ('error' in made) return fail(made.error!);
  if (it) setCollectionItem(uid, made.id, it, true);
  return Response.json({ id: made.id }, { status: 201 });
};
