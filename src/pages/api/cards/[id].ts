import type { APIRoute } from 'astro';
import { deleteUserCard, fail, intId, readBody, updateUserCard } from '../../../server/personal';

// Accepts 'U12' or '12'.
const num = (id?: string) => intId(id?.replace(/^U/, ''));

// { front, back }
export const PATCH: APIRoute = async ({ request, locals, params }) => {
  const b = await readBody(request);
  const r = b ? updateUserCard(locals.user!.id, num(params.id), b) : 'invalid';
  return r === 'ok' ? Response.json({ ok: true }) : r === 'missing' ? fail('Card not found.', 404) : fail('Write a front (up to 1000 characters) and a back (up to 2000).');
};

export const DELETE: APIRoute = ({ locals, params }) =>
  deleteUserCard(locals.user!.id, num(params.id)) ? Response.json({ ok: true }) : fail('Card not found.', 404);
