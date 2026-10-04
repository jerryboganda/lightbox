import type { APIRoute } from 'astro';
import { deleteCollection, fail, intId, readBody, updateCollection } from '../../../server/personal';

// { name?, description?, shared?: boolean }
export const PATCH: APIRoute = async ({ request, locals, params }) => {
  const b = await readBody(request);
  if (!b) return fail('Nothing to change.');
  const r = updateCollection(locals.user!.id, intId(params.id), { name: b.name, description: b.description, shared: b.shared });
  return r === 'ok' ? Response.json({ ok: true }) : r === 'missing' ? fail('Collection not found.', 404) : fail('Check the name (1 to 80 characters) and description (up to 500).');
};

export const DELETE: APIRoute = ({ locals, params }) =>
  deleteCollection(locals.user!.id, intId(params.id)) ? Response.json({ ok: true }) : fail('Collection not found.', 404);
