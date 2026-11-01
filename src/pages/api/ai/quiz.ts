import type { APIRoute } from 'astro';
import { createFactsQuiz } from '../../../server/exams';
import { fail, readBody } from '../../../server/personal';

// { factIds: string[] } -> a 5-question quiz on the topics those facts belong to (the tutor's "Quiz me").
export const POST: APIRoute = async ({ request, locals }) => {
  const b = await readBody(request);
  const ids = Array.isArray(b?.factIds) ? b!.factIds.filter((x: unknown): x is string => typeof x === 'string' && x.length <= 40).slice(0, 20) : [];
  if (!ids.length) return fail('No facts to quiz on.');
  const id = createFactsQuiz(locals.user!.id, ids);
  return typeof id === 'string' ? fail(id) : Response.json({ id, href: `/practice/exam/${id}` }, { status: 201 });
};
