import type { APIRoute } from 'astro';
import { denied, isAdmin } from '../../../server/admin';
import { gaps } from '../../../server/gaps';
import { health } from '../../../server/log';

// Admin-only JSON: content gaps (?days=, 7-365, default 60) and, with ?health=1, server health.
export const GET: APIRoute = ({ locals, url }) => {
  if (!isAdmin(locals.user)) return denied();
  const d = Number(url.searchParams.get('days'));
  const days = Number.isInteger(d) && d >= 7 && d <= 365 ? d : 60;
  return Response.json({ gaps: gaps(days), ...(url.searchParams.get('health') ? { health: health() } : {}) }, { headers: { 'cache-control': 'no-store' } });
};
