import type { APIRoute } from 'astro';
import { createTopicQuiz } from '../../../server/exams';
import { weakFor } from '../../../server/analytics';
import { fail, readBody } from '../../../server/personal';

// { slug } → a 3-question Fix-it check on that topic; remembers the weakness score it started from.
export const POST: APIRoute = async ({ request, locals }) => {
  const b = await readBody(request);
  const slug = typeof b?.slug === 'string' ? b.slug.slice(0, 120) : '';
  if (!slug) return fail('Choose a topic.');
  const uid = locals.user!.id;
  const id = createTopicQuiz(uid, slug, 3, weakFor(uid, slug)?.score ?? 0);
  return typeof id === 'string' ? fail(id) : Response.json({ id, href: `/practice/exam/${id}` }, { status: 201 });
};
