import type { APIRoute } from 'astro';
import { follow, sse, tutorReply } from '../../../../../server/ai';
import { fail, intId, readBody } from '../../../../../server/personal';

// { text } asks a new question; { retry: true } answers the last question again. -> text/event-stream
export const POST: APIRoute = async ({ request, locals, params }) => {
  const b = await readBody(request);
  if (!b) return fail('Invalid request.');
  const ac = follow(request.signal);
  return sse(tutorReply(locals.user!.id, intId(params.id), { text: b.text, retry: b.retry }, ac.signal), ac);
};
