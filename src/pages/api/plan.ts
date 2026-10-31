import type { APIRoute } from 'astro';
import { plan } from '../../server/planner';
import { getProfile } from '../../server/profile';

// ?m=15|30|60 (any 10-240) → today's ordered study plan. Defaults to the minutes from onboarding.
export const GET: APIRoute = ({ locals, url }) => {
  const uid = locals.user!.id;
  const m = Number(url.searchParams.get('m')) || getProfile(uid).minutes;
  return Response.json(plan(uid, m), { headers: { 'cache-control': 'no-store' } });
};
