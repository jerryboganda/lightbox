import type { APIRoute } from 'astro';
import { setGoals, today } from '../../server/analytics';

// Goals plus today's progress toward them.
export const GET: APIRoute = ({ locals }) => Response.json(today(locals.user!.id));

export const PUT: APIRoute = async ({ request, locals }) => {
  const body = await request.json().catch(() => null);
  const r = setGoals(locals.user!.id, body);
  return typeof r === 'string' ? Response.json({ error: r }, { status: 400 }) : Response.json(today(locals.user!.id));
};
