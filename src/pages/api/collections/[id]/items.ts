import type { APIRoute } from 'astro';
import { fail, intId, item, readBody, reorderCollection, setCollectionItem } from '../../../../server/personal';

// Add or remove one item: { type, id, on: boolean }
export const POST: APIRoute = async ({ request, locals, params }) => {
  const uid = locals.user!.id, b = await readBody(request);
  const it = b && item(uid, b.type, b.id, false);
  if (!b || !it || typeof b.on !== 'boolean') return fail('Unknown item.');
  return setCollectionItem(uid, intId(params.id), it, b.on) ? Response.json({ ok: true }) : fail('Collection not found or full.', 404);
};

// New order: { order: [{ type, id }, ...] }
export const PUT: APIRoute = async ({ request, locals, params }) => {
  const b = await readBody(request);
  return b && reorderCollection(locals.user!.id, intId(params.id), b.order) ? Response.json({ ok: true }) : fail('Collection not found.', 404);
};
