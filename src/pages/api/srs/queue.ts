import type { APIRoute } from 'astro';
import { srsQueue } from '../../../server/progress';

export const GET: APIRoute = ({ locals }) => Response.json(srsQueue(locals.user!.id), { headers: { 'cache-control': 'no-store' } });
