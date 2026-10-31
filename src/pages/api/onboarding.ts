import type { APIRoute } from 'astro';
import { getProfile, saveOnboarding, skipOnboarding } from '../../server/profile';
import { getGoals } from '../../server/analytics';
import { fail, readBody } from '../../server/personal';

export const GET: APIRoute = ({ locals }) => Response.json({ profile: getProfile(locals.user!.id), goals: getGoals(locals.user!.id) });

// { examDate, minutes, confidence: { system: 1-5 } } | { skip: true }
export const POST: APIRoute = async ({ request, locals }) => {
  const b = await readBody(request);
  if (!b) return fail('Nothing to save.');
  if (b.skip === true) return Response.json({ profile: skipOnboarding(locals.user!.id), goals: getGoals(locals.user!.id) });
  const r = saveOnboarding(locals.user!.id, b);
  return typeof r === 'string' ? fail(r) : Response.json(r);
};
