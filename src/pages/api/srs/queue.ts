import type { APIRoute } from 'astro';
import { srsQueue } from '../../../server/progress';

// ?topic= or ?sys= put that topic's or system's cards first.
export const GET: APIRoute = ({ locals, url }) =>
  Response.json(srsQueue(locals.user!.id, { topic: url.searchParams.get('topic'), system: url.searchParams.get('sys') }), { headers: { 'cache-control': 'no-store' } });
