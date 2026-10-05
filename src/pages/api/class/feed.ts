import type { APIRoute } from 'astro';
import { feed } from '../../../server/class';

// Latest comments across the class, newest first.
export const GET: APIRoute = () => Response.json(feed(20), { headers: { 'cache-control': 'no-store' } });
