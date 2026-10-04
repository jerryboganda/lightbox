import type { APIRoute } from 'astro';
import { createUserCard, fail, listUserCards, readBody } from '../../../server/personal';

export const GET: APIRoute = ({ locals }) => Response.json(listUserCards(locals.user!.id), { headers: { 'cache-control': 'no-store' } });

// { front, back, factId?, path? }
export const POST: APIRoute = async ({ request, locals }) => {
  const b = await readBody(request);
  const id = b && createUserCard(locals.user!.id, b);
  return id ? Response.json({ id: `U${id}` }, { status: 201 }) : fail('Write a front (up to 1000 characters) and a back (up to 2000).');
};
