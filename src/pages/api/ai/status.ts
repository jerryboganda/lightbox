import type { APIRoute } from 'astro';
import { aiEnabled, quota } from '../../../server/ai';

export const GET: APIRoute = ({ locals }) => Response.json({ enabled: aiEnabled(), ...quota(locals.user!.id) }, { headers: { 'cache-control': 'no-store' } });
