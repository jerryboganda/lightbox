import type { APIRoute } from 'astro';
import { createExam, parseBuild } from '../../../server/exams';

// Builder posts JSON; the result is the new session to open.
export const POST: APIRoute = async ({ request, locals }) => {
  const b = parseBuild(await request.json().catch(() => null));
  if (typeof b === 'string') return Response.json({ error: b }, { status: 400 });
  const id = createExam(locals.user!.id, b);
  return typeof id === 'string' ? Response.json({ error: id }, { status: 400 }) : Response.json({ id, href: `/practice/exam/${id}` }, { status: 201 });
};
