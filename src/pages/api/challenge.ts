import type { APIRoute } from 'astro';
import { startChallenge } from '../../server/exams';
import { fail } from '../../server/personal';

// Starts (or resumes) this week's class challenge. A plain form post lands on the exam; fetch callers get JSON.
export const POST: APIRoute = async ({ request, locals, redirect }) => {
  const id = startChallenge(locals.user!.id);
  const json = request.headers.get('accept')?.includes('application/json');
  if (typeof id === 'string') return json ? fail(id) : redirect('/class?challenge=unavailable', 303);
  return json ? Response.json({ id, href: `/practice/exam/${id}` }, { status: 201 }) : redirect(`/practice/exam/${id}`, 303);
};
